import React from 'react';
import { cn } from '@/utils/cn';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'game' | 'player';
}

export const Card: React.FC<CardProps> = ({
  children,
  className,
  variant = 'default',
}) => {
  const variants = {
    default: 'bg-white shadow-lg',
    game: 'bg-gradient-to-br from-game-purple/10 to-game-blue/10 border border-game-purple/20',
    player: 'bg-game-surface border border-game-purple/30',
  };

  return (
    <div className={cn('rounded-xl p-6', variants[variant], className)}>
      {children}
    </div>
  );
};
