# SolTrivia Frontend

A Web3 trivia game built on Solana with real-time multiplayer gameplay, blockchain-verified achievements, and player progression.

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Git

### Installation
```bash
# Clone the repository
git clone https://github.com/gboigwe/soltrivia.git
cd soltrivia-frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

### Environment Variables
Create a `.env.local` file with:
```env
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_RPC_ENDPOINT=https://api.devnet.solana.com
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

## 🏗️ Project Structure

```
src/
├── app/              # Next.js 14 App Router pages
├── components/       # React components
│   ├── ui/          # Base UI components
│   ├── game/        # Game-specific components
│   ├── wallet/      # Wallet integration
│   └── layout/      # Layout components
├── hooks/           # Custom React hooks
├── lib/             # Configuration and utilities
├── stores/          # State management
├── types/           # TypeScript definitions
└── utils/           # Helper functions
```

## 🎮 Features

- ✅ Wallet connection with Solana
- ✅ Real-time multiplayer gameplay
- ✅ Player profiles and statistics
- ✅ Achievement system
- ✅ Leaderboards
- ✅ Mobile-responsive design

## 🛠️ Tech Stack

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Animations**: Framer Motion
- **State Management**: Zustand
- **Real-time**: Socket.io
- **Blockchain**: Solana Web3.js

## 📱 Development Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
npm run type-check   # Type check without building
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License.
