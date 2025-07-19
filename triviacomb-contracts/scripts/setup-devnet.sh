#!/bin/bash

# Script to set up TriviaComb contracts on Solana devnet
# Prerequisites: Solana CLI, Anchor CLI, and generated keypairs

echo "🚀 Setting up TriviaComb contracts on Solana devnet..."

# Check if required tools are installed
if ! command -v solana &> /dev/null; then
    echo "❌ Solana CLI not found. Please install from https://docs.solana.com/cli/install-solana-cli-tools"
    exit 1
fi

if ! command -v anchor &> /dev/null; then
    echo "❌ Anchor CLI not found. Please install from https://www.anchor-lang.com/docs/installation"
    exit 1
fi

# Set Solana cluster to devnet
echo "Setting Solana cluster to devnet..."
solana config set --url https://api.devnet.solana.com

# Check if authority keypair exists
if [ ! -f "keys/authority.json" ]; then
    echo "❌ Authority keypair not found. Please run 'npm run keys:generate' first."
    exit 1
fi

# Set wallet to authority keypair
echo "Setting wallet to authority keypair..."
solana config set --keypair keys/authority.json

# Request airdrop for authority account
echo "Requesting SOL airdrop for authority account..."
AUTHORITY_PUBKEY=$(solana-keygen pubkey keys/authority.json)
solana airdrop 2 $AUTHORITY_PUBKEY

# Wait a moment for airdrop to process
sleep 3

# Check balance
echo "Authority account balance:"
solana balance $AUTHORITY_PUBKEY

# Build the programs
echo "Building Anchor programs..."
anchor build

# Deploy programs to devnet
echo "Deploying programs to devnet..."
anchor deploy --provider.cluster devnet

# Initialize programs
echo "Initializing programs..."
# Note: You would need to create initialization scripts for each program

echo "✅ Setup complete!"
echo ""
echo "📋 Deployment Summary:"
echo "   - Cluster: Solana Devnet"
echo "   - Authority: $AUTHORITY_PUBKEY"
echo "   - Programs deployed and ready for use"
echo ""
echo "🔗 Useful Links:"
echo "   - Solana Explorer: https://explorer.solana.com/?cluster=devnet"
echo "   - Authority Account: https://explorer.solana.com/address/$AUTHORITY_PUBKEY?cluster=devnet"
echo ""
echo "📝 Next Steps:"
echo "   1. Update your frontend with the deployed program IDs"
echo "   2. Test the programs using the test suite"
echo "   3. Initialize program states as needed"