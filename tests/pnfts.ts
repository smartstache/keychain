import * as anchor from "@project-serum/anchor";
import {AnchorProvider, Idl, Program, Wallet, web3} from "@project-serum/anchor";

import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction, TransactionMessage, VersionedTransaction
} from "@solana/web3.js";
import {
  createNFT, createpNFT, createTokenMint,
  findDomainPda,
  findDomainStatePda,
  findKeychainKeyPda,
  findKeychainPda,
  findKeychainStatePda,
  findListingPda, sleep,
} from "./utils";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {expect} from "chai";

import { Keychain } from "../target/types/keychain";
import { Yardsale } from "../target/types/yardsale";
import {PnftHelper} from "./pnft-helper";
import NodeWallet from "@project-serum/anchor/dist/cjs/nodewallet";


///// this test is set up to run in devnet (since it uses metaplex programs)

// then u can run: anchor test --provider.cluster localnet --skip-local-validator

function randomName() {
  let name = Math.random().toString(36).substring(2, 5) + Math.random().toString(36).substring(2, 5);
  return name.toLowerCase();
}

// metaplex default ruleset account
const DEFAULT_RULESET = new PublicKey('eBJLFYPxJmMGKuFwpDWkzxZeUrad92kZRC5BJLpzyT9');

// for setting up the keychain
const domain = randomName();
// const treasury = anchor.web3.Keypair.generate();
let treasury  = new PublicKey('2zDgaEmrKUpQ66oh2NcQjqWsy2kxLpN1C24Nt9PVf7zK');
const renameCost = new anchor.BN(anchor.web3.LAMPORTS_PER_SOL * 0.01);

const username = randomName();    // used as the keychain name

let builder;
let tx: Transaction;
let txid;


describe("yardsale pnfts",  () => {
  let provider = anchor.AnchorProvider.env();
  let connection = provider.connection;

  /*
  const rpcUrl = "http://127.0.0.1:8899/";
  let connection = new web3.Connection(rpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 45000,
  });
  provider = new AnchorProvider(connection, provider.wallet, provider.opts);
  // Configure the client to use the local cluster.
  anchor.setProvider(provider);
   */

  const KeychainProgram = anchor.workspace.Keychain as Program<Keychain>;
  const YardsaleProgram = anchor.workspace.Yardsale as Program<Yardsale>;

  // const KeychainProgram = new Program(workxpaceKeychainProgram.idl, workxpaceKeychainProgram.programId, provider);
  // const YardsaleProgram = new Program(workspaceYardsaleProgram.idl, workspaceYardsaleProgram.programId, provider);

  console.log(`--> yardsale program id: ${YardsaleProgram.programId.toBase58()} \n --> keychain program id: ${KeychainProgram.programId.toBase58()}`);

  const pNftTransferClient = new PnftHelper(provider.connection, provider.wallet as anchor.Wallet)
  pNftTransferClient.setProgram();

  let userKeychainPda: PublicKey;
  let domainPda: PublicKey;

  let proceedsAccount: Keypair = Keypair.generate();

  /*
  await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(proceedsAccount.publicKey, anchor.web3.LAMPORTS_PER_SOL * 0.5),
      "confirmed"
  );

   */

  // let buyer = Keypair.fromSecretKey(Uint8Array.from([72,168,28,72,245,98,82,123,49,55,241,100,175,239,203,42,145,109,110,208,119,20,71,135,87,254,31,115,203,93,7,3,51,188,204,16,228,129,247,81,203,103,228,251,97,163,32,156,127,191,24,229,31,102,197,64,123,10,227,15,122,174,40,100]));
  // console.log(`buyer: ${buyer.publicKey.toBase58()}`);

  let buyer: Keypair = Keypair.generate();
  // let buyer = new PublicKey('BPhtwoopE2bG6ArCM9VPREx6tV6RMWmj5Q8Fysc1y8Ye');

  console.log(`\n\n...>>> user: ${provider.wallet.publicKey.toBase58()}`);

  // the pNFTs that we'll work with
  const pnfts: PublicKey[] = [];

  it("sets up testing env", async () => {

    console.log(`provider url: ${provider.connection.rpcEndpoint}`);

    // create a few pNFTs
    for (let i = 0; i < 1; i++) {
      const pnftMint = await createpNFT(provider);
      console.log(`created pNFT: ${pnftMint.toBase58()}`);
      pnfts.push(pnftMint);
    }

    // send a little bit of sol to the buyer
    let tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          // toPubkey: buyer.publicKey, // create a random receiver
          toPubkey: buyer.publicKey, // create a random receiver
          lamports: 0.2 * LAMPORTS_PER_SOL,
        })
    );

    txid = await provider.sendAndConfirm(tx);
    console.log(`sent ${0.2} sol to buyer: ${buyer.publicKey.toBase58()}`);

    // create the keychain domain + user's keychain

    // our domain account
    [domainPda] = findDomainPda(domain, KeychainProgram.programId);
    const [domainStatePda, domainStatePdaBump] = findDomainStatePda(domain, KeychainProgram.programId);

    // our keychain accounts
    [userKeychainPda] = findKeychainPda(username, domain, KeychainProgram.programId);
    const [userKeychainStatePda] = findKeychainStatePda(userKeychainPda, domain, KeychainProgram.programId);
    // the "pointer" keychain key account
    const [userKeychainKeyPda] = findKeychainKeyPda(provider.wallet.publicKey, domain, KeychainProgram.programId);

    console.log(`creating keychain domain: ${domain}...`);

    // first create the domain
    txid = await KeychainProgram.methods.createDomain(domain, renameCost).accounts({
      domain: domainPda,
      domainState: domainStatePda,
      authority: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
      treasury: treasury
    }).rpc();
    console.log(`created keychain domain tx: ${txid}`);

    console.log(`creating keychain for : ${username}...`);

    // then create the keychain
    txid = await KeychainProgram.methods.createKeychain(username).accounts({
      keychain: userKeychainPda,
      keychainState: userKeychainStatePda,
      keychainKey: userKeychainKeyPda,
      domain: domainPda,
      authority: provider.wallet.publicKey,
      wallet: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    }).rpc();

    console.log(`created keychain for ${username}. tx: ${txid}`);

  });

  it("list and buy a pNFT in sol", async () => {

    // the pnft to list
    let pnft = pnfts[0];
    // let pnft = new PublicKey("BxNTU4QQRUEbZtmWmJmxL4yWLrNg6XifqS3wGmKUJ2M");

    // user's nft token account
    let fromItemToken = getAssociatedTokenAddressSync(pnft, provider.wallet.publicKey);
    let buyerItemToken = getAssociatedTokenAddressSync(pnft, buyer.publicKey, false);
    let [listingPda] = findListingPda(pnft, username, domain, YardsaleProgram.programId);
    // listing's ata
    let listingItemToken = getAssociatedTokenAddressSync(pnft, listingPda, true);

    // first: list the item

    let sellerItemToken = getAssociatedTokenAddressSync(pnft, provider.wallet.publicKey);
    let tokenBalance = await provider.connection.getTokenAccountBalance(sellerItemToken);
    expect(tokenBalance.value.uiAmount).to.equal(1);

    let price = new anchor.BN(anchor.web3.LAMPORTS_PER_SOL * 0.01);
    builder = await pNftTransferClient.buildListPNFT(price, {
      domain: domainPda,
      keychain: userKeychainPda,
      item: pnft,
      listing: listingPda,
      currency: NATIVE_MINT,
      proceeds: proceedsAccount.publicKey,
      proceedsToken: null,
      listingItemToken,
      seller: provider.wallet.publicKey
    });

    tx = new Transaction().add(await builder.instruction());

    txid = await provider.sendAndConfirm(tx);

    console.log(`listed pNFT ${pnft.toBase58()} in tx: ${txid}`);
    console.log(`creatorItemToken: ${sellerItemToken.toBase58()}`);
    console.log(`listingPda: ${listingPda.toBase58()} \nlistingItemToken: ${listingItemToken.toBase58()}`);

    // check that the pnft got transferred to the listing ata
    tokenBalance = await connection.getTokenAccountBalance(listingItemToken);
    expect(tokenBalance.value.uiAmount).to.equal(1);
    tokenBalance = await connection.getTokenAccountBalance(sellerItemToken);
    expect(tokenBalance.value.uiAmount).to.equal(0);


    console.log(`---------- buying ------------ `);

    const buyerProvider = new AnchorProvider(connection, new NodeWallet(buyer), provider.opts);
    const listingAcct = await YardsaleProgram.account.listing.fetch(listingPda);
    console.log(`listing account: ${listingPda.toString()}`, listingAcct);


    ///// now let's buy this guy
    builder = await pNftTransferClient.buildPurchasePNFT({
      item: pnft,
      listing: listingPda,
      currency: NATIVE_MINT,
      proceeds: proceedsAccount.publicKey,
      proceedsToken: null,
      listingItemToken,
      buyer: buyer.publicKey,
      buyerCurrencyToken: null,          // since this is a sol purchase don't need
      // treasury: treasury.publicKey,
      treasury,
      ruleset: DEFAULT_RULESET
    });

    // need to create the buyer's ata first
    // /*
    tx = new Transaction();
    tx.add(
        createAssociatedTokenAccountInstruction(buyer.publicKey, buyerItemToken, buyer.publicKey, pnft)
    );

    // create buyer ata in 1 tx
    /*
    txid = await buyerProvider.sendAndConfirm(tx);
    console.log(`created buyer's ata: ${buyerItemToken.toString()} in tx: ${txid}`);
    */

    tx = tx.add(await builder.instruction());

    txid = await buyerProvider.sendAndConfirm(tx);


    console.log(`---------- purchased! ------------ `);
    console.log(`bought pNFT ${pnft.toBase58()} in tx: ${txid}`);
    console.log(`buyer: ${buyer.publicKey.toBase58()}`);

    const newReceiverBalance = await provider.connection.getTokenAccountBalance(buyerItemToken);
    expect(newReceiverBalance.value.uiAmount).to.equal(1)

    // the listing's token account should be gone as well as the listing account
    let accountInfo = await connection.getAccountInfo(listingItemToken);
    expect(accountInfo).to.be.null;
    accountInfo = await connection.getAccountInfo(listingPda);
    expect(accountInfo).to.be.null;


  });


});



