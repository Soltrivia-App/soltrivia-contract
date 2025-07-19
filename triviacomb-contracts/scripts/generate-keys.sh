#!/bin/bash

# Script to generate all required keypairs for TriviaComb contracts
# Make sure solana-keygen is installed and in your PATH

echo "🔑 Generating keypairs for TriviaComb contracts..."

# Create keys directory if it doesn't exist
mkdir -p keys

# Generate authority keypair (main admin)
echo "Generating authority keypair..."
solana-keygen new --outfile keys/authority.json --no-bip39-passphrase --force

# Generate program keypairs
echo "Generating program keypairs..."
solana-keygen new --outfile keys/question_bank.json --no-bip39-passphrase --force
solana-keygen new --outfile keys/tournament_manager.json --no-bip39-passphrase --force
solana-keygen new --outfile keys/reward_distributor.json --no-bip39-passphrase --force

# Generate test account keypairs
echo "Generating test user keypairs..."
solana-keygen new --outfile keys/test_user1.json --no-bip39-passphrase --force
solana-keygen new --outfile keys/test_user2.json --no-bip39-passphrase --force
solana-keygen new --outfile keys/test_user3.json --no-bip39-passphrase --force

# Generate admin keypairs
echo "Generating admin keypair..."
solana-keygen new --outfile keys/admin.json --no-bip39-passphrase --force

echo "✅ All keypairs generated successfully!"
echo ""
echo "📋 Keypairs created:"
echo "   - keys/authority.json (Main authority)"
echo "   - keys/question_bank.json (Question Bank program)"
echo "   - keys/tournament_manager.json (Tournament Manager program)"
echo "   - keys/reward_distributor.json (Reward Distributor program)"
echo "   - keys/test_user1.json (Test user 1)"
echo "   - keys/test_user2.json (Test user 2)"
echo "   - keys/test_user3.json (Test user 3)"
echo "   - keys/admin.json (Admin account)"
echo ""
echo "⚠️  SECURITY WARNING:"
echo "   - Keep these keypairs secure and never commit them to version control"
echo "   - For production, use hardware wallets or secure key management"
echo "   - These are for development/testing only"

# Display public keys for reference
echo ""
echo "📋 Public Keys (for reference):"
echo "Authority: $(solana-keygen pubkey keys/authority.json)"
echo "Question Bank: $(solana-keygen pubkey keys/question_bank.json)"
echo "Tournament Manager: $(solana-keygen pubkey keys/tournament_manager.json)"
echo "Reward Distributor: $(solana-keygen pubkey keys/reward_distributor.json)"