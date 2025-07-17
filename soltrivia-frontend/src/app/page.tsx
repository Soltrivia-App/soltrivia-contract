import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="container mx-auto px-4 py-12">
      <div className="text-center mb-12">
        <h1 className="text-6xl font-bold text-white mb-4">
          Sol<span className="text-game-purple">Trivia</span>
        </h1>
        <p className="text-xl text-gray-300 max-w-2xl mx-auto">
          Challenge your knowledge in the ultimate Web3 trivia experience. 
          Compete with players worldwide and earn rewards on the Solana blockchain.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
        <Card variant="game" className="text-center">
          <div className="text-4xl mb-4">🎮</div>
          <h3 className="text-xl font-semibold text-white mb-2">Real-time Multiplayer</h3>
          <p className="text-gray-300">Compete with up to 8 players in live trivia battles</p>
        </Card>

        <Card variant="game" className="text-center">
          <div className="text-4xl mb-4">🏆</div>
          <h3 className="text-xl font-semibold text-white mb-2">Blockchain Rewards</h3>
          <p className="text-gray-300">Earn achievements and rewards stored on Solana</p>
        </Card>

        <Card variant="game" className="text-center">
          <div className="text-4xl mb-4">📚</div>
          <h3 className="text-xl font-semibold text-white mb-2">Multiple Categories</h3>
          <p className="text-gray-300">Test your knowledge across various topics</p>
        </Card>
      </div>

      <div className="text-center space-x-4">
        <Link href="/lobby">
          <Button size="lg" className="px-8">
            Start Playing
          </Button>
        </Link>
        <Link href="/profile">
          <Button variant="outline" size="lg" className="px-8">
            View Profile
          </Button>
        </Link>
      </div>
    </main>
  );
}
