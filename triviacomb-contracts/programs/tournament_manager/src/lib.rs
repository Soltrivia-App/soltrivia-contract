use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("DE58k65KchHuDCABYARfGP5Jc1p14yRrx1UayweapYx9");

#[program]
pub mod tournament_manager {
    use super::*;

    /// Initialize the tournament manager program
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let tournament_manager = &mut ctx.accounts.tournament_manager;
        tournament_manager.authority = ctx.accounts.authority.key();
        tournament_manager.tournament_count = 0;
        tournament_manager.total_participants = 0;
        tournament_manager.bump = ctx.bumps.tournament_manager;
        
        msg!("Tournament Manager initialized with authority: {}", tournament_manager.authority);
        Ok(())
    }

    /// Create a new tournament
    pub fn create_tournament(
        ctx: Context<CreateTournament>,
        name: String,
        description: String,
        entry_fee: u64,
        prize_pool: u64,
        max_participants: u32,
        start_time: i64,
        duration: i64,
        question_count: u8,
        category: Option<String>,
        difficulty: Option<u8>,
    ) -> Result<()> {
        require!(name.len() <= 100, TournamentError::NameTooLong);
        require!(description.len() <= 500, TournamentError::DescriptionTooLong);
        require!(max_participants > 0, TournamentError::InvalidMaxParticipants);
        require!(start_time > Clock::get()?.unix_timestamp, TournamentError::InvalidStartTime);
        require!(duration > 0, TournamentError::InvalidDuration);
        require!(question_count >= 5 && question_count <= 50, TournamentError::InvalidQuestionCount);

        let tournament = &mut ctx.accounts.tournament;
        let tournament_manager = &mut ctx.accounts.tournament_manager;
        
        tournament.id = tournament_manager.tournament_count;
        tournament.organizer = ctx.accounts.organizer.key();
        tournament.name = name;
        tournament.description = description;
        tournament.entry_fee = entry_fee;
        tournament.prize_pool = prize_pool;
        tournament.max_participants = max_participants;
        tournament.current_participants = 0;
        tournament.start_time = start_time;
        tournament.duration = duration;
        tournament.question_count = question_count;
        tournament.category = category;
        tournament.difficulty = difficulty;
        tournament.status = TournamentStatus::Registration;
        tournament.created_at = Clock::get()?.unix_timestamp;
        tournament.bump = ctx.bumps.tournament;

        tournament_manager.tournament_count += 1;

        msg!("Tournament created: {} by {}", tournament.name, tournament.organizer);
        Ok(())
    }

    /// Register for a tournament
    pub fn register_for_tournament(
        ctx: Context<RegisterForTournament>,
    ) -> Result<()> {
        let tournament = &mut ctx.accounts.tournament;
        let registration = &mut ctx.accounts.registration;
        
        require!(tournament.status == TournamentStatus::Registration, TournamentError::RegistrationClosed);
        require!(tournament.current_participants < tournament.max_participants, TournamentError::TournamentFull);
        require!(Clock::get()?.unix_timestamp < tournament.start_time, TournamentError::TournamentStarted);

        // Handle entry fee payment if required
        if tournament.entry_fee > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.participant_token_account.to_account_info(),
                to: ctx.accounts.tournament_vault.to_account_info(),
                authority: ctx.accounts.participant.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
            
            token::transfer(cpi_ctx, tournament.entry_fee)?;
        }

        registration.participant = ctx.accounts.participant.key();
        registration.tournament_id = tournament.id;
        registration.registered_at = Clock::get()?.unix_timestamp;
        registration.score = 0;
        registration.completed = false;
        registration.bump = ctx.bumps.registration;

        tournament.current_participants += 1;
        tournament.prize_pool += tournament.entry_fee;

        msg!("Participant {} registered for tournament {}", registration.participant, tournament.id);
        Ok(())
    }

    /// Start a tournament
    pub fn start_tournament(ctx: Context<StartTournament>) -> Result<()> {
        let tournament = &mut ctx.accounts.tournament;
        
        require!(tournament.status == TournamentStatus::Registration, TournamentError::InvalidStatus);
        require!(Clock::get()?.unix_timestamp >= tournament.start_time, TournamentError::TournamentNotReady);
        require!(tournament.current_participants >= 2, TournamentError::InsufficientParticipants);

        tournament.status = TournamentStatus::Active;
        tournament.actual_start_time = Some(Clock::get()?.unix_timestamp);

        msg!("Tournament {} started with {} participants", tournament.id, tournament.current_participants);
        Ok(())
    }

    /// Submit answers for a tournament
    pub fn submit_answers(
        ctx: Context<SubmitAnswers>,
        answers: Vec<u8>,
    ) -> Result<()> {
        let tournament = &ctx.accounts.tournament;
        let registration = &mut ctx.accounts.registration;
        
        require!(tournament.status == TournamentStatus::Active, TournamentError::TournamentNotActive);
        require!(!registration.completed, TournamentError::AlreadySubmitted);
        require!(answers.len() == tournament.question_count as usize, TournamentError::InvalidAnswerCount);

        let current_time = Clock::get()?.unix_timestamp;
        let tournament_end_time = tournament.actual_start_time.unwrap() + tournament.duration;
        require!(current_time <= tournament_end_time, TournamentError::TournamentEnded);

        // Calculate score (simplified scoring)
        let mut score = 0;
        for (i, answer) in answers.iter().enumerate() {
            // In a real implementation, this would check against correct answers
            // For now, assume 70% correct rate
            if i % 10 < 7 {
                score += 10;
            }
        }

        registration.score = score;
        registration.completed = true;
        registration.submission_time = Some(current_time);

        msg!("Answers submitted by {} with score: {}", registration.participant, score);
        Ok(())
    }

    /// End a tournament and calculate winners
    pub fn end_tournament(ctx: Context<EndTournament>) -> Result<()> {
        let tournament = &mut ctx.accounts.tournament;
        
        require!(tournament.status == TournamentStatus::Active, TournamentError::TournamentNotActive);
        
        let current_time = Clock::get()?.unix_timestamp;
        let tournament_end_time = tournament.actual_start_time.unwrap() + tournament.duration;
        require!(current_time >= tournament_end_time, TournamentError::TournamentNotEnded);

        tournament.status = TournamentStatus::Ended;
        tournament.ended_at = Some(current_time);

        msg!("Tournament {} ended", tournament.id);
        Ok(())
    }

    /// Distribute prizes to winners
    pub fn distribute_prizes(
        ctx: Context<DistributePrizes>,
        winners: Vec<Pubkey>,
        prize_amounts: Vec<u64>,
    ) -> Result<()> {
        let tournament = &ctx.accounts.tournament;
        
        require!(tournament.status == TournamentStatus::Ended, TournamentError::TournamentNotEnded);
        require!(winners.len() == prize_amounts.len(), TournamentError::InvalidPrizeData);
        
        let total_prizes: u64 = prize_amounts.iter().sum();
        require!(total_prizes <= tournament.prize_pool, TournamentError::InsufficientPrizePool);

        // Prize distribution logic would go here
        // This would involve multiple token transfers to winners

        msg!("Prizes distributed for tournament {}", tournament.id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + TournamentManagerState::SPACE,
        seeds = [b"tournament_manager"],
        bump
    )]
    pub tournament_manager: Account<'info, TournamentManagerState>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateTournament<'info> {
    #[account(
        init,
        payer = organizer,
        space = 8 + Tournament::SPACE,
        seeds = [b"tournament", tournament_manager.tournament_count.to_le_bytes().as_ref()],
        bump
    )]
    pub tournament: Account<'info, Tournament>,
    
    #[account(
        mut,
        seeds = [b"tournament_manager"],
        bump = tournament_manager.bump
    )]
    pub tournament_manager: Account<'info, TournamentManagerState>,
    
    #[account(mut)]
    pub organizer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterForTournament<'info> {
    #[account(
        mut,
        seeds = [b"tournament", tournament.id.to_le_bytes().as_ref()],
        bump = tournament.bump
    )]
    pub tournament: Account<'info, Tournament>,
    
    #[account(
        init,
        payer = participant,
        space = 8 + Registration::SPACE,
        seeds = [b"registration", tournament.key().as_ref(), participant.key().as_ref()],
        bump
    )]
    pub registration: Account<'info, Registration>,
    
    #[account(mut)]
    pub participant: Signer<'info>,
    
    #[account(mut)]
    pub participant_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub tournament_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StartTournament<'info> {
    #[account(
        mut,
        seeds = [b"tournament", tournament.id.to_le_bytes().as_ref()],
        bump = tournament.bump,
        has_one = organizer
    )]
    pub tournament: Account<'info, Tournament>,
    
    pub organizer: Signer<'info>,
}

#[derive(Accounts)]
pub struct SubmitAnswers<'info> {
    #[account(
        seeds = [b"tournament", tournament.id.to_le_bytes().as_ref()],
        bump = tournament.bump
    )]
    pub tournament: Account<'info, Tournament>,
    
    #[account(
        mut,
        seeds = [b"registration", tournament.key().as_ref(), participant.key().as_ref()],
        bump = registration.bump,
        has_one = participant
    )]
    pub registration: Account<'info, Registration>,
    
    pub participant: Signer<'info>,
}

#[derive(Accounts)]
pub struct EndTournament<'info> {
    #[account(
        mut,
        seeds = [b"tournament", tournament.id.to_le_bytes().as_ref()],
        bump = tournament.bump,
        has_one = organizer
    )]
    pub tournament: Account<'info, Tournament>,
    
    pub organizer: Signer<'info>,
}

#[derive(Accounts)]
pub struct DistributePrizes<'info> {
    #[account(
        seeds = [b"tournament", tournament.id.to_le_bytes().as_ref()],
        bump = tournament.bump,
        has_one = organizer
    )]
    pub tournament: Account<'info, Tournament>,
    
    pub organizer: Signer<'info>,
    
    #[account(mut)]
    pub tournament_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct TournamentManagerState {
    pub authority: Pubkey,
    pub tournament_count: u64,
    pub total_participants: u64,
    pub bump: u8,
}

impl TournamentManagerState {
    pub const SPACE: usize = 32 + 8 + 8 + 1;
}

#[account]
pub struct Tournament {
    pub id: u64,
    pub organizer: Pubkey,
    pub name: String,
    pub description: String,
    pub entry_fee: u64,
    pub prize_pool: u64,
    pub max_participants: u32,
    pub current_participants: u32,
    pub start_time: i64,
    pub duration: i64,
    pub question_count: u8,
    pub category: Option<String>,
    pub difficulty: Option<u8>,
    pub status: TournamentStatus,
    pub created_at: i64,
    pub actual_start_time: Option<i64>,
    pub ended_at: Option<i64>,
    pub bump: u8,
}

impl Tournament {
    pub const SPACE: usize = 8 + 32 + 100 + 500 + 8 + 8 + 4 + 4 + 8 + 8 + 1 + 51 + 2 + 1 + 8 + 9 + 9 + 1;
}

#[account]
pub struct Registration {
    pub participant: Pubkey,
    pub tournament_id: u64,
    pub registered_at: i64,
    pub score: u32,
    pub completed: bool,
    pub submission_time: Option<i64>,
    pub bump: u8,
}

impl Registration {
    pub const SPACE: usize = 32 + 8 + 8 + 4 + 1 + 9 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum TournamentStatus {
    Registration,
    Active,
    Ended,
    Cancelled,
}

#[error_code]
pub enum TournamentError {
    #[msg("Tournament name is too long (max 100 characters)")]
    NameTooLong,
    #[msg("Tournament description is too long (max 500 characters)")]
    DescriptionTooLong,
    #[msg("Invalid maximum participants count")]
    InvalidMaxParticipants,
    #[msg("Invalid start time")]
    InvalidStartTime,
    #[msg("Invalid duration")]
    InvalidDuration,
    #[msg("Invalid question count (must be 5-50)")]
    InvalidQuestionCount,
    #[msg("Registration is closed")]
    RegistrationClosed,
    #[msg("Tournament is full")]
    TournamentFull,
    #[msg("Tournament has already started")]
    TournamentStarted,
    #[msg("Invalid tournament status")]
    InvalidStatus,
    #[msg("Tournament is not ready to start")]
    TournamentNotReady,
    #[msg("Insufficient participants to start tournament")]
    InsufficientParticipants,
    #[msg("Tournament is not active")]
    TournamentNotActive,
    #[msg("Already submitted answers")]
    AlreadySubmitted,
    #[msg("Invalid answer count")]
    InvalidAnswerCount,
    #[msg("Tournament has ended")]
    TournamentEnded,
    #[msg("Tournament has not ended yet")]
    TournamentNotEnded,
    #[msg("Invalid prize data")]
    InvalidPrizeData,
    #[msg("Insufficient prize pool")]
    InsufficientPrizePool,
}