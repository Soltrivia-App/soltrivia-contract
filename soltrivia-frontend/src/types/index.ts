export interface Player {
  id: string;
  walletAddress: string;
  displayName: string;
  avatar?: string;
  score: number;
  isReady: boolean;
  isHost: boolean;
}

export interface GameRoom {
  id: string;
  code: string;
  hostId: string;
  players: Player[];
  gameState: 'waiting' | 'starting' | 'active' | 'finished';
  settings: GameSettings;
  currentQuestion?: Question;
  questionIndex: number;
}

export interface GameSettings {
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  questionCount: number;
  timePerQuestion: number;
  maxPlayers: number;
}

export interface Question {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  category: string;
  difficulty: string;
  timeLimit: number;
}

export interface GameAnswer {
  playerId: string;
  questionId: string;
  selectedAnswer: number;
  timeElapsed: number;
  isCorrect: boolean;
}
