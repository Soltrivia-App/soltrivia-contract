export const GAME_CONSTANTS = {
  MAX_PLAYERS: 8,
  MIN_PLAYERS: 2,
  DEFAULT_QUESTION_TIME: 30,
  DEFAULT_QUESTION_COUNT: 10,
  SCORE_PER_CORRECT: 100,
  SPEED_BONUS_THRESHOLD: 10, // seconds
  CATEGORIES: [
    'General Knowledge',
    'Science',
    'History',
    'Sports',
    'Entertainment',
    'Technology',
    'Geography',
    'Blockchain'
  ],
  DIFFICULTIES: ['easy', 'medium', 'hard'] as const,
} as const;

export const SOCKET_EVENTS = {
  // Room events
  JOIN_ROOM: 'join-room',
  LEAVE_ROOM: 'leave-room',
  PLAYER_JOINED: 'player-joined',
  PLAYER_LEFT: 'player-left',
  
  // Game events
  START_GAME: 'start-game',
  GAME_STARTED: 'game-started',
  NEW_QUESTION: 'new-question',
  SUBMIT_ANSWER: 'submit-answer',
  ANSWER_SUBMITTED: 'answer-submitted',
  ROUND_ENDED: 'round-ended',
  GAME_FINISHED: 'game-finished',
  
  // General
  ERROR: 'error',
  DISCONNECT: 'disconnect',
} as const;
