import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const USDC_DECIMALS = 6;
const usdc = (amount: number) => BigInt(amount) * 10n ** BigInt(USDC_DECIMALS);
const BPS = 10_000n;
const ONE_DAY = 86400;
const SEVEN_DAYS = 7 * ONE_DAY;
const THIRTY_DAYS = 30 * ONE_DAY;

async function getBlockTimestamp() {
  const block = await ethers.provider.getBlock("latest");
  return block!.timestamp;
}

async function increaseTime(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

// ═══════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════

async function deployFullProtocol() {
  const [admin, feeCollector, buyer, supplier, workflow, arbitrator, user2] =
    await ethers.getSigners();

  // Deploy MockUSDC
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUsdc = await MockUSDC.deploy();

  // Mint USDC to buyer
  await mockUsdc.mint(buyer.address, usdc(100_000));
  await mockUsdc.mint(user2.address, usdc(100_000));

  // Deploy PriceOracle
  const PriceOracle = await ethers.getContractFactory("PriceOracle");
  const priceOracle = await PriceOracle.deploy(admin.address);

  // Deploy AgentRegistry
  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const agentRegistry = await AgentRegistry.deploy(admin.address);

  // Deploy EscrowVault
  const EscrowVault = await ethers.getContractFactory("EscrowVault");
  const escrowVault = await EscrowVault.deploy(
    await mockUsdc.getAddress(),
    admin.address,
    feeCollector.address
  );

  // Deploy PurchaseOrder
  const PurchaseOrder = await ethers.getContractFactory("PurchaseOrder");
  const purchaseOrder = await PurchaseOrder.deploy(
    admin.address,
    await escrowVault.getAddress()
  );

  // Deploy DisputeResolver
  const DisputeResolver = await ethers.getContractFactory("DisputeResolver");
  const disputeResolver = await DisputeResolver.deploy(
    await mockUsdc.getAddress(),
    admin.address,
    await escrowVault.getAddress()
  );

  // ── Post-deployment config ──
  await escrowVault.connect(admin).setPurchaseOrderContract(await purchaseOrder.getAddress());
  await escrowVault.connect(admin).setDisputeResolver(await disputeResolver.getAddress());
  await escrowVault.connect(admin).setAuthorizedWorkflow(workflow.address, true);
  await agentRegistry.connect(admin).setAuthorizedUpdater(await escrowVault.getAddress(), true);
  await agentRegistry.connect(admin).setAuthorizedUpdater(workflow.address, true);
  await priceOracle.connect(admin).setAuthorizedUpdater(workflow.address, true);
  await disputeResolver.connect(admin).setArbitrator(arbitrator.address, true);

  return {
    mockUsdc,
    priceOracle,
    agentRegistry,
    escrowVault,
    purchaseOrder,
    disputeResolver,
    admin,
    feeCollector,
    buyer,
    supplier,
    workflow,
    arbitrator,
    user2,
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST: EscrowVault
// ═══════════════════════════════════════════════════════════════

describe("EscrowVault", function () {
  it("should create a deal and lock USDC", async function () {
    const { escrowVault, mockUsdc, buyer, supplier } = await deployFullProtocol();
    const amount = usdc(500);
    const deadline = (await getBlockTimestamp()) + THIRTY_DAYS;

    await mockUsdc.connect(buyer).approve(await escrowVault.getAddress(), amount);

    await expect(
      escrowVault.connect(buyer).createDeal(1, supplier.address, amount, deadline, "ipfs://metadata1")
    )
      .to.emit(escrowVault, "DealCreated")
      .withArgs(1n, 1n, buyer.address, supplier.address, amount);

    const deal = await escrowVault.getDeal(1);
    expect(deal.status).to.equal(1n); // Locked
    expect(deal.amount).to.equal(amount);
    expect(deal.buyer).to.equal(buyer.address);

    // USDC should be in escrow
    expect(await mockUsdc.balanceOf(await escrowVault.getAddress())).to.equal(amount);
  });

  it("should reject deal with amount below minimum", async function () {
    const { escrowVault, mockUsdc, buyer, supplier } = await deployFullProtocol();
    const deadline = (await getBlockTimestamp()) + THIRTY_DAYS;

    await mockUsdc.connect(buyer).approve(await escrowVault.getAddress(), usdc(10));
    await expect(
      escrowVault.connect(buyer).createDeal(1, supplier.address, usdc(10), deadline, "ipfs://x")
    ).to.be.revertedWithCustomError(escrowVault, "ZeroAmount");
  });

  it("should reject deal with past deadline", async function () {
    const { escrowVault, mockUsdc, buyer, supplier } = await deployFullProtocol();
    const pastDeadline = (await getBlockTimestamp()) - 100;

    await mockUsdc.connect(buyer).approve(await escrowVault.getAddress(), usdc(500));
    await expect(
      escrowVault.connect(buyer).createDeal(1, supplier.address, usdc(500), pastDeadline, "ipfs://x")
    ).to.be.revertedWithCustomError(escrowVault, "DeadlineInPast");
  });

  it("should progress through full deal lifecycle", async function () {
    const { escrowVault, mockUsdc, buyer, supplier, workflow, feeCollector } =
      await deployFullProtocol();
    const amount = usdc(1000);
    const deadline = (await getBlockTimestamp()) + THIRTY_DAYS;

    // Create deal
    await mockUsdc.connect(buyer).approve(await escrowVault.getAddress(), amount);
    await escrowVault.connect(buyer).createDeal(1, supplier.address, amount, deadline, "ipfs://deal1");

    // Confirm
    await expect(escrowVault.connect(workflow).confirmDeal(1))
      .to.emit(escrowVault, "DealConfirmed")
      .withArgs(1n);

    // Ship
    await expect(escrowVault.connect(workflow).markShipped(1))
      .to.emit(escrowVault, "DealShipped")
      .withArgs(1n);

    // Deliver
    const supplierBalBefore = await mockUsdc.balanceOf(supplier.address);
    await expect(escrowVault.connect(workflow).confirmDelivery(1))
      .to.emit(escrowVault, "DealDelivered");

    // Verify supplier got paid (amount - 2.5% fee)
    const fee = (amount * 250n) / BPS;
    const supplierBalAfter = await mockUsdc.balanceOf(supplier.address);
    expect(supplierBalAfter - supplierBalBefore).to.equal(amount - fee);

    // Verify fees accumulated
    expect(await escrowVault.accumulatedFees()).to.equal(fee);

    // Deal should be Completed
    const deal = await escrowVault.getDeal(1);
    expect(deal.status).to.equal(5n); // Completed
  });

  it("should allow buyer to cancel a locked deal", async function () {
    const { escrowVault, mockUsdc, buyer, supplier } = await deployFullProtocol();
    const amount = usdc(500);
    const deadline = (await getBlockTimestamp()) + THIRTY_DAYS;

    await mockUsdc.connect(buyer).approve(await escrowVault.getAddress(), amount);
    await escrowVault.connect(buyer).createDeal(1, supplier.address, amount, deadline, "ipfs://x");

    const balBefore = await mockUsdc.balanceOf(buyer.address);
    await escrowVault.connect(buyer).cancelDeal(1);
    const balAfter = await mockUsdc.balanceOf(buyer.address);

    expect(balAfter - balBefore).to.equal(amount);
    expect((await escrowVault.getDeal(1)).status).to.equal(8n); // Cancelled
  });

  it("should not allow non-buyer to cancel", async function () {
    const { escrowVault, mockUsdc, buyer, supplier, user2 } = await deployFullProtocol();
    const deadline = (await getBlockTimestamp()) + THIRTY_DAYS;

    await mockUsdc.connect(buyer).approve(await escrowVault.getAddress(), usdc(500));
    await escrowVault.connect(buyer).createDeal(1, supplier.address, usdc(500), deadline, "ipfs://x");

    await expect(
      escrowVault.connect(user2).cancelDeal(1)
    ).to.be.revertedWithCustomError(escrowVault, "OnlyBuyer");
  });

  it("should handle express settlement with premium", async function () {
    const { escrowVault, mockUsdc, buyer, supplier, workflow } = await deployFullProtocol();
    const amount = usdc(1000);
    const deadline = (await getBlockTimestamp()) + THIRTY_DAYS;

    await mockUsdc.connect(buyer).approve(await escrowVault.getAddress(), amount);
    await escrowVault.connect(buyer).createDeal(1, supplier.address, amount, deadline, "ipfs://x");
    await escrowVault.connect(workflow).confirmDeal(1);
    await escrowVault.connect(workflow).markShipped(1);

    // Express settle
    const supplierBefore = await mockUsdc.balanceOf(supplier.address);
    await escrowVault.connect(buyer).expressSettle(1);

    const platformFee = (amount * 250n) / BPS;
    const expressPremium = (amount * 50n) / BPS;
    const totalFee = platformFee + expressPremium;
    const supplierAfter = await mockUsdc.balanceOf(supplier.address);

    expect(supplierAfter - supplierBefore).to.equal(amount - totalFee);
    expect(await escrowVault.accumulatedFees()).to.equal(totalFee);
  });

  it("should allow claiming expired deals", async function () {
    const { escrowVault, mockUsdc, buyer, supplier, user2 } = await deployFullProtocol();
    const amount = usdc(500);
    const deadline = (await getBlockTimestamp()) + ONE_DAY;

    await mockUsdc.connect(buyer).approve(await escrowVault.getAddress(), amount);
    await escrowVault.connect(buyer).createDeal(1, supplier.address, amount, deadline, "ipfs://x");

    // Try before deadline
    await expect(escrowVault.connect(user2).claimExpiredDeal(1))
      .to.be.revertedWithCustomError(escrowVault, "DealExpired");

    // Advance time past deadline
    await increaseTime(ONE_DAY + 1);

    const balBefore = await mockUsdc.balanceOf(buyer.address);
    await escrowVault.connect(user2).claimExpiredDeal(1); // Anyone can call
    const balAfter = await mockUsdc.balanceOf(buyer.address);

    expect(balAfter - balBefore).to.equal(amount);
  });

  it("should not allow unauthorized workflow calls", async function () {
    const { escrowVault, mockUsdc, buyer, supplier, user2 } = await deployFullProtocol();
    const deadline = (await getBlockTimestamp()) + THIRTY_DAYS;

    await mockUsdc.connect(buyer).approve(await escrowVault.getAddress(), usdc(500));
    await escrowVault.connect(buyer).createDeal(1, supplier.address, usdc(500), deadline, "ipfs://x");

    await expect(
      escrowVault.connect(user2).confirmDeal(1)
    ).to.be.revertedWithCustomError(escrowVault, "OnlyWorkflow");
  });

  it("should enforce status transitions", async function () {
    const { escrowVault, mockUsdc, buyer, supplier, workflow } = await deployFullProtocol();
    const deadline = (await getBlockTimestamp()) + THIRTY_DAYS;

    await mockUsdc.connect(buyer).approve(await escrowVault.getAddress(), usdc(500));
    await escrowVault.connect(buyer).createDeal(1, supplier.address, usdc(500), deadline, "ipfs://x");

    // Can't ship before confirm
    await expect(
      escrowVault.connect(workflow).markShipped(1)
    ).to.be.revertedWithCustomError(escrowVault, "InvalidDealStatus");

    // Can't deliver before ship
    await expect(
      escrowVault.connect(workflow).confirmDelivery(1)
    ).to.be.revertedWithCustomError(escrowVault, "InvalidDealStatus");
  });

  it("should implement 2-step admin transfer", async function () {
    const { escrowVault, admin, user2 } = await deployFullProtocol();

    await escrowVault.connect(admin).transferAdmin(user2.address);
    expect(await escrowVault.admin()).to.equal(admin.address); // Not changed yet

    await escrowVault.connect(user2).acceptAdmin();
    expect(await escrowVault.admin()).to.equal(user2.address);
  });

  it("should withdraw accumulated fees", async function () {
    const { escrowVault, mockUsdc, buyer, supplier, workflow, admin, feeCollector } =
      await deployFullProtocol();
    const amount = usdc(1000);
    const deadline = (await getBlockTimestamp()) + THIRTY_DAYS;

    // Complete a deal to generate fees
    await mockUsdc.connect(buyer).approve(await escrowVault.getAddress(), amount);
    await escrowVault.connect(buyer).createDeal(1, supplier.address, amount, deadline, "ipfs://x");
    await escrowVault.connect(workflow).confirmDeal(1);
    await escrowVault.connect(workflow).markShipped(1);
    await escrowVault.connect(workflow).confirmDelivery(1);

    const fee = (amount * 250n) / BPS;
    const collectorBefore = await mockUsdc.balanceOf(feeCollector.address);

    await escrowVault.connect(admin).withdrawFees();

    const collectorAfter = await mockUsdc.balanceOf(feeCollector.address);
    expect(collectorAfter - collectorBefore).to.equal(fee);
    expect(await escrowVault.accumulatedFees()).to.equal(0n);
  });
});

// ═══════════════════════════════════════════════════════════════
// TEST: AgentRegistry
// ═══════════════════════════════════════════════════════════════

describe("AgentRegistry", function () {
  it("should create an agent with categories", async function () {
    const { agentRegistry, buyer } = await deployFullProtocol();

    await expect(
      agentRegistry.connect(buyer).createAgent(
        ["phone-cases", "screen-protectors"],
        usdc(50),
        usdc(5000)
      )
    ).to.emit(agentRegistry, "AgentCreated").withArgs(1n, buyer.address);

    const [config, categories] = await agentRegistry.getAgent(1);
    expect(config.owner).to.equal(buyer.address);
    expect(config.active).to.be.true;
    expect(config.minOrderSize).to.equal(usdc(50));
    expect(categories.length).to.equal(2);
    expect(categories[0]).to.equal("phone-cases");
  });

  it("should enforce agent limits per tier", async function () {
    const { agentRegistry, buyer } = await deployFullProtocol();

    // Free tier = 1 agent
    await agentRegistry.connect(buyer).createAgent(["cat1"], usdc(50), usdc(5000));

    await expect(
      agentRegistry.connect(buyer).createAgent(["cat2"], usdc(50), usdc(5000))
    ).to.be.revertedWithCustomError(agentRegistry, "MaxAgentsReached");
  });

  it("should allow more agents after tier upgrade", async function () {
    const { agentRegistry, admin, buyer } = await deployFullProtocol();

    await agentRegistry.connect(buyer).createAgent(["cat1"], usdc(50), usdc(5000));

    // Upgrade to Pro (3 agents)
    await agentRegistry.connect(admin).setUserTier(buyer.address, 1);

    await agentRegistry.connect(buyer).createAgent(["cat2"], usdc(50), usdc(5000));
    await agentRegistry.connect(buyer).createAgent(["cat3"], usdc(50), usdc(5000));

    const agentIds = await agentRegistry.getAgentsByOwner(buyer.address);
    expect(agentIds.length).to.equal(3);
  });

  it("should update agent stats on deal completion", async function () {
    const { agentRegistry, buyer, workflow } = await deployFullProtocol();

    await agentRegistry.connect(buyer).createAgent(["cat1"], usdc(50), usdc(5000));

    await agentRegistry.connect(workflow).recordDealCompletion(1, usdc(500), true);
    await agentRegistry.connect(workflow).recordDealCompletion(1, usdc(300), true);
    await agentRegistry.connect(workflow).recordDealCompletion(1, usdc(200), false);

    const [totalDeals, totalVolume, successRate] = await agentRegistry.getAgentStats(1);
    expect(totalDeals).to.equal(3n);
    expect(totalVolume).to.equal(usdc(1000));
    expect(successRate).to.equal(6666n); // ~66.66% in bps
  });

  it("should deactivate and reactivate agents", async function () {
    const { agentRegistry, buyer } = await deployFullProtocol();

    await agentRegistry.connect(buyer).createAgent(["cat1"], usdc(50), usdc(5000));
    expect(await agentRegistry.isAgentActive(1)).to.be.true;

    await agentRegistry.connect(buyer).deactivateAgent(1);
    expect(await agentRegistry.isAgentActive(1)).to.be.false;

    await agentRegistry.connect(buyer).reactivateAgent(1);
    expect(await agentRegistry.isAgentActive(1)).to.be.true;
  });

  it("should reject invalid order range", async function () {
    const { agentRegistry, buyer } = await deployFullProtocol();

    await expect(
      agentRegistry.connect(buyer).createAgent(["cat1"], usdc(5000), usdc(50))
    ).to.be.revertedWithCustomError(agentRegistry, "InvalidOrderRange");
  });

  it("should not allow non-owner to modify agent", async function () {
    const { agentRegistry, buyer, user2 } = await deployFullProtocol();

    await agentRegistry.connect(buyer).createAgent(["cat1"], usdc(50), usdc(5000));

    await expect(
      agentRegistry.connect(user2).deactivateAgent(1)
    ).to.be.revertedWithCustomError(agentRegistry, "NotAgentOwner");
  });
});

// ═══════════════════════════════════════════════════════════════
// TEST: PriceOracle
// ═══════════════════════════════════════════════════════════════

describe("PriceOracle", function () {
  it("should update and query prices", async function () {
    const { priceOracle, workflow } = await deployFullProtocol();
    const productHash = ethers.keccak256(ethers.toUtf8Bytes("iphone-16-case"));

    const entries = [
      {
        productHash,
        unitPrice: usdc(0.38),         // $0.38 per unit (380000 in 6 decimals... actually 0)
        moq: 500n,
        shippingCost: usdc(127),
        supplierScore: 8500n,
        timestamp: BigInt(await getBlockTimestamp()),
        supplierRef: "SZ-MOBI-001",
      },
      {
        productHash,
        unitPrice: 450000n,            // $0.45
        moq: 200n,
        shippingCost: usdc(89),
        supplierScore: 7200n,
        timestamp: BigInt(await getBlockTimestamp()),
        supplierRef: "GZ-TECH-042",
      },
    ];

    await priceOracle.connect(workflow).updatePrice(productHash, entries);

    const [storedEntries, timestamp] = await priceOracle.getPrice(productHash);
    expect(storedEntries.length).to.equal(2);
    expect(timestamp).to.be.greaterThan(0n);
  });

  it("should find best price and best supplier", async function () {
    const { priceOracle, workflow } = await deployFullProtocol();
    const hash = ethers.keccak256(ethers.toUtf8Bytes("screen-protector"));

    const entries = [
      { productHash: hash, unitPrice: 500000n, moq: 100n, shippingCost: usdc(50), supplierScore: 9000n, timestamp: BigInt(await getBlockTimestamp()), supplierRef: "A" },
      { productHash: hash, unitPrice: 300000n, moq: 500n, shippingCost: usdc(80), supplierScore: 7500n, timestamp: BigInt(await getBlockTimestamp()), supplierRef: "B" },
      { productHash: hash, unitPrice: 400000n, moq: 200n, shippingCost: usdc(60), supplierScore: 8800n, timestamp: BigInt(await getBlockTimestamp()), supplierRef: "C" },
    ];

    await priceOracle.connect(workflow).updatePrice(hash, entries);

    const bestPrice = await priceOracle.getBestPrice(hash);
    expect(bestPrice.unitPrice).to.equal(300000n); // Cheapest
    expect(bestPrice.supplierRef).to.equal("B");

    const bestSupplier = await priceOracle.getBestSupplier(hash);
    expect(bestSupplier.supplierScore).to.equal(9000n); // Highest score
    expect(bestSupplier.supplierRef).to.equal("A");
  });

  it("should batch update prices", async function () {
    const { priceOracle, workflow } = await deployFullProtocol();
    const hash1 = ethers.keccak256(ethers.toUtf8Bytes("product-1"));
    const hash2 = ethers.keccak256(ethers.toUtf8Bytes("product-2"));
    const ts = BigInt(await getBlockTimestamp());

    const allEntries = [
      { productHash: hash1, unitPrice: 100000n, moq: 100n, shippingCost: usdc(10), supplierScore: 8000n, timestamp: ts, supplierRef: "S1" },
      { productHash: hash1, unitPrice: 120000n, moq: 50n, shippingCost: usdc(15), supplierScore: 7500n, timestamp: ts, supplierRef: "S2" },
      { productHash: hash2, unitPrice: 200000n, moq: 200n, shippingCost: usdc(20), supplierScore: 9000n, timestamp: ts, supplierRef: "S3" },
    ];

    await priceOracle.connect(workflow).batchUpdatePrices(
      [hash1, hash2],
      allEntries,
      [2, 1] // 2 entries for hash1, 1 for hash2
    );

    expect(await priceOracle.getEntryCount(hash1)).to.equal(2n);
    expect(await priceOracle.getEntryCount(hash2)).to.equal(1n);
    expect(await priceOracle.getProductCount()).to.equal(2n);
  });

  it("should track price freshness", async function () {
    const { priceOracle, workflow } = await deployFullProtocol();
    const hash = ethers.keccak256(ethers.toUtf8Bytes("test-product"));

    const entries = [
      { productHash: hash, unitPrice: 100000n, moq: 100n, shippingCost: 0n, supplierScore: 8000n, timestamp: BigInt(await getBlockTimestamp()), supplierRef: "S1" },
    ];

    await priceOracle.connect(workflow).updatePrice(hash, entries);
    expect(await priceOracle.isPriceFresh(hash)).to.be.true;

    // Advance time past staleness threshold (6 hours default)
    await increaseTime(6 * 3600 + 1);
    expect(await priceOracle.isPriceFresh(hash)).to.be.false;
  });

  it("should reject unauthorized updates", async function () {
    const { priceOracle, buyer } = await deployFullProtocol();
    const hash = ethers.keccak256(ethers.toUtf8Bytes("test"));

    await expect(
      priceOracle.connect(buyer).updatePrice(hash, [])
    ).to.be.reverted;
  });

  it("should compute product hash consistently", async function () {
    const { priceOracle } = await deployFullProtocol();

    const hash = await priceOracle.computeProductHash("iphone-16-case");
    const expected = ethers.keccak256(ethers.toUtf8Bytes("iphone-16-case"));
    expect(hash).to.equal(expected);
  });
});

// ═══════════════════════════════════════════════════════════════
// TEST: PurchaseOrder
// ═══════════════════════════════════════════════════════════════

describe("PurchaseOrder", function () {
  it("should mint PO NFT from escrow", async function () {
    const { purchaseOrder, escrowVault, buyer, admin } = await deployFullProtocol();

    // Mint directly from escrow (simulate)
    const escrowAddr = await escrowVault.getAddress();
    const poContract = purchaseOrder.connect(
      await ethers.getImpersonatedSigner(escrowAddr)
    );

    // Fund the impersonated signer
    await admin.sendTransaction({ to: escrowAddr, value: ethers.parseEther("1") });

    await poContract.mintPurchaseOrder(buyer.address, 1, "ipfs://po-metadata-1", true);

    expect(await purchaseOrder.ownerOf(1)).to.equal(buyer.address);
    expect(await purchaseOrder.tokenDealId(1)).to.equal(1n);
    expect(await purchaseOrder.tokenStatus(1)).to.equal(1n); // Locked
    expect(await purchaseOrder.transferLocked(1)).to.be.true;
    expect(await purchaseOrder.totalSupply()).to.equal(1n);
  });

  it("should prevent transfer of soulbound PO", async function () {
    const { purchaseOrder, escrowVault, buyer, user2, admin } = await deployFullProtocol();

    const escrowAddr = await escrowVault.getAddress();
    await admin.sendTransaction({ to: escrowAddr, value: ethers.parseEther("1") });
    const poContract = purchaseOrder.connect(await ethers.getImpersonatedSigner(escrowAddr));

    await poContract.mintPurchaseOrder(buyer.address, 1, "ipfs://po-1", true);

    await expect(
      purchaseOrder.connect(buyer).transferFrom(buyer.address, user2.address, 1)
    ).to.be.revertedWith("PurchaseOrder: soulbound token");
  });

  it("should allow transfer of non-soulbound PO", async function () {
    const { purchaseOrder, escrowVault, buyer, user2, admin } = await deployFullProtocol();

    const escrowAddr = await escrowVault.getAddress();
    await admin.sendTransaction({ to: escrowAddr, value: ethers.parseEther("1") });
    const poContract = purchaseOrder.connect(await ethers.getImpersonatedSigner(escrowAddr));

    await poContract.mintPurchaseOrder(buyer.address, 2, "ipfs://po-2", false);

    await purchaseOrder.connect(buyer).transferFrom(buyer.address, user2.address, 1);
    expect(await purchaseOrder.ownerOf(1)).to.equal(user2.address);
  });

  it("should support ERC-165", async function () {
    const { purchaseOrder } = await deployFullProtocol();

    expect(await purchaseOrder.supportsInterface("0x80ac58cd")).to.be.true;  // ERC721
    expect(await purchaseOrder.supportsInterface("0x01ffc9a7")).to.be.true;  // ERC165
    expect(await purchaseOrder.supportsInterface("0xdeadbeef")).to.be.false;
  });
});

// ═══════════════════════════════════════════════════════════════
// TEST: DisputeResolver
// ═══════════════════════════════════════════════════════════════

describe("DisputeResolver", function () {
  // Helper: create a deal and advance it to "Shipped" status
  async function createShippedDeal() {
    const fixture = await deployFullProtocol();
    const { escrowVault, mockUsdc, buyer, supplier, workflow } = fixture;
    const amount = usdc(1000);
    const deadline = (await getBlockTimestamp()) + THIRTY_DAYS;

    await mockUsdc.connect(buyer).approve(await escrowVault.getAddress(), amount);
    await escrowVault.connect(buyer).createDeal(1, supplier.address, amount, deadline, "ipfs://deal");
    await escrowVault.connect(workflow).confirmDeal(1);
    await escrowVault.connect(workflow).markShipped(1);

    // Also mint some USDC for dispute fee
    await mockUsdc.mint(buyer.address, usdc(100));
    await mockUsdc.connect(buyer).approve(await fixture.disputeResolver.getAddress(), usdc(100));

    return fixture;
  }

  it("should file a dispute and lock deal", async function () {
    const { disputeResolver, escrowVault, buyer } = await createShippedDeal();

    await expect(
      disputeResolver.connect(buyer).fileDispute(1, "Item not as described")
    )
      .to.emit(disputeResolver, "DisputeFiled")
      .withArgs(1n, 1n, buyer.address);

    const dispute = await disputeResolver.getDispute(1);
    expect(dispute.status).to.equal(1n); // Filed
    expect(dispute.reason).to.equal("Item not as described");

    // Deal should be Disputed
    expect(await escrowVault.getDealStatus(1)).to.equal(6n); // Disputed
  });

  it("should allow supplier to respond", async function () {
    const { disputeResolver, buyer, supplier } = await createShippedDeal();

    await disputeResolver.connect(buyer).fileDispute(1, "Wrong item received");
    await expect(
      disputeResolver.connect(supplier).supplierRespond(1, "Item was correct, proof attached")
    )
      .to.emit(disputeResolver, "SupplierResponded")
      .withArgs(1n, "Item was correct, proof attached");

    expect((await disputeResolver.getDispute(1)).status).to.equal(2n); // SupplierResponded
  });

  it("should resolve dispute with full buyer refund", async function () {
    const { disputeResolver, mockUsdc, buyer, supplier, arbitrator } = await createShippedDeal();
    const buyerBalBefore = await mockUsdc.balanceOf(buyer.address);

    await disputeResolver.connect(buyer).fileDispute(1, "Never received");

    await disputeResolver.connect(arbitrator).resolveDispute(1, 10_000); // 100% to buyer

    const dispute = await disputeResolver.getDispute(1);
    expect(dispute.outcome).to.equal(1n); // BuyerWins
    expect(dispute.buyerRefundBps).to.equal(10_000n);

    // Buyer should get refund (minus platform fee from escrow)
    const buyerBalAfter = await mockUsdc.balanceOf(buyer.address);
    expect(buyerBalAfter).to.be.greaterThan(buyerBalBefore);
  });

  it("should resolve dispute with split", async function () {
    const { disputeResolver, buyer, arbitrator } = await createShippedDeal();

    await disputeResolver.connect(buyer).fileDispute(1, "Partial damage");
    await disputeResolver.connect(arbitrator).resolveDispute(1, 5_000); // 50/50

    const dispute = await disputeResolver.getDispute(1);
    expect(dispute.outcome).to.equal(3n); // Split
  });

  it("should auto-expire dispute after 7 days with no supplier response", async function () {
    const { disputeResolver, mockUsdc, buyer, user2 } = await createShippedDeal();

    await disputeResolver.connect(buyer).fileDispute(1, "No response from supplier");

    // Can't expire before deadline
    await expect(
      disputeResolver.connect(user2).expireDispute(1)
    ).to.be.revertedWithCustomError(disputeResolver, "SupplierDeadlineNotReached");

    // Advance 7 days
    await increaseTime(SEVEN_DAYS + 1);

    const buyerBalBefore = await mockUsdc.balanceOf(buyer.address);
    await disputeResolver.connect(user2).expireDispute(1); // Anyone can call

    const dispute = await disputeResolver.getDispute(1);
    expect(dispute.status).to.equal(4n); // Expired
    expect(dispute.outcome).to.equal(1n); // BuyerWins

    // Buyer gets full refund + dispute fee back
    const buyerBalAfter = await mockUsdc.balanceOf(buyer.address);
    expect(buyerBalAfter).to.be.greaterThan(buyerBalBefore);
  });

  it("should prevent duplicate disputes per deal", async function () {
    const { disputeResolver, buyer, mockUsdc } = await createShippedDeal();

    await disputeResolver.connect(buyer).fileDispute(1, "Issue 1");

    await mockUsdc.connect(buyer).approve(await disputeResolver.getAddress(), usdc(10));
    await expect(
      disputeResolver.connect(buyer).fileDispute(1, "Issue 2")
    ).to.be.revertedWithCustomError(disputeResolver, "DisputeAlreadyExists");
  });

  it("should not allow non-buyer to file dispute", async function () {
    const fixture = await createShippedDeal();
    const { disputeResolver, mockUsdc, user2 } = fixture;

    await mockUsdc.mint(user2.address, usdc(100));
    await mockUsdc.connect(user2).approve(await disputeResolver.getAddress(), usdc(100));

    await expect(
      disputeResolver.connect(user2).fileDispute(1, "Not my deal")
    ).to.be.reverted;
  });
});

// ═══════════════════════════════════════════════════════════════
// TEST: Integration — Full E2E Flow
// ═══════════════════════════════════════════════════════════════

describe("Integration: Full E2E Flow", function () {
  it("should complete entire procurement lifecycle", async function () {
    const {
      mockUsdc, priceOracle, agentRegistry, escrowVault,
      buyer, supplier, workflow, admin, feeCollector,
    } = await deployFullProtocol();

    // 1. Buyer creates an agent
    await agentRegistry.connect(buyer).createAgent(
      ["phone-cases", "charging-cables"], usdc(100), usdc(10_000)
    );

    // 2. CRE Price Scanner updates oracle
    const productHash = ethers.keccak256(ethers.toUtf8Bytes("phone-cases"));
    await priceOracle.connect(workflow).updatePrice(productHash, [{
      productHash,
      unitPrice: 380000n, // $0.38
      moq: 500n,
      shippingCost: usdc(127),
      supplierScore: 8500n,
      timestamp: BigInt(await getBlockTimestamp()),
      supplierRef: "SZ-MOBI-001",
    }]);

    // 3. Buyer approves and creates deal
    const dealAmount = usdc(317); // 500 * $0.38 + $127 shipping
    const deadline = (await getBlockTimestamp()) + THIRTY_DAYS;
    await mockUsdc.connect(buyer).approve(await escrowVault.getAddress(), dealAmount);
    await escrowVault.connect(buyer).createDeal(1, supplier.address, dealAmount, deadline, "ipfs://deal-001");

    // 4. CRE Deal Executor confirms with supplier
    await escrowVault.connect(workflow).confirmDeal(1);

    // 5. CRE marks as shipped
    await escrowVault.connect(workflow).markShipped(1);

    // 6. CRE Delivery Verifier confirms delivery
    await escrowVault.connect(workflow).confirmDelivery(1);

    // 7. Record stats on agent
    await agentRegistry.connect(workflow).recordDealCompletion(1, dealAmount, true);

    // ── Verify final state ──
    const deal = await escrowVault.getDeal(1);
    expect(deal.status).to.equal(5n); // Completed

    const fee = (dealAmount * 250n) / BPS;
    expect(await mockUsdc.balanceOf(supplier.address)).to.equal(dealAmount - fee);

    const [totalDeals, totalVolume, successRate] = await agentRegistry.getAgentStats(1);
    expect(totalDeals).to.equal(1n);
    expect(totalVolume).to.equal(dealAmount);
    expect(successRate).to.equal(10_000n); // 100%

    expect(await priceOracle.isPriceFresh(productHash)).to.be.true;

    // Withdraw fees
    await escrowVault.connect(admin).withdrawFees();
    expect(await mockUsdc.balanceOf(feeCollector.address)).to.equal(fee);
  });
});
