use anchor_lang::prelude::*;

declare_id!("CSRftWGDWFCbwvib9s6XbnqJheuSR5eVPmieKGDJmA7Y");

#[program]
pub mod question_bank {
    use super::*;

    /// Initialize the Question Bank program
    /// Sets up the global state with authority and initial curators
    pub fn initialize_question_bank(
        ctx: Context<InitializeQuestionBank>,
        authority: Pubkey,
    ) -> Result<()> {
        let question_bank = &mut ctx.accounts.question_bank;
        
        question_bank.authority = authority;
        question_bank.total_questions = 0;
        question_bank.active_questions = 0;
        question_bank.curators = vec![authority]; // Authority is initial curator
        question_bank.bump = ctx.bumps.question_bank;
        
        msg!("Question Bank initialized with authority: {}", authority);
        Ok(())
    }

    /// Submit a new trivia question for community review
    /// Requires minimum reputation and validates question format
    pub fn submit_question(
        ctx: Context<SubmitQuestion>,
        question_data: QuestionData,
    ) -> Result<()> {
        // Validate question format
        require!(
            question_data.question_text.len() <= 500,
            QuestionBankError::InvalidQuestionFormat
        );
        require!(
            question_data.category.len() <= 50,
            QuestionBankError::InvalidQuestionFormat
        );
        require!(
            question_data.difficulty >= 1 && question_data.difficulty <= 3,
            QuestionBankError::InvalidQuestionFormat
        );
        require!(
            question_data.correct_answer <= 3,
            QuestionBankError::InvalidQuestionFormat
        );

        // Validate each option length
        for option in &question_data.options {
            require!(
                option.len() <= 100,
                QuestionBankError::InvalidQuestionFormat
            );
        }

        // Check if user has sufficient reputation (minimum 100 for new questions)
        let user_reputation = &ctx.accounts.user_reputation;
        require!(
            user_reputation.reputation_score >= 100,
            QuestionBankError::InsufficientReputation
        );

        let question = &mut ctx.accounts.question;
        let question_bank = &mut ctx.accounts.question_bank;
        
        // Initialize question
        question.id = question_bank.total_questions;
        question.submitter = ctx.accounts.submitter.key();
        question.question_text = question_data.question_text;
        question.options = question_data.options;
        question.correct_answer = question_data.correct_answer;
        question.category = question_data.category;
        question.difficulty = question_data.difficulty;
        question.votes_approve = 0;
        question.votes_reject = 0;
        question.voters = Vec::new();
        question.status = QuestionStatus::Pending;
        question.created_at = Clock::get()?.unix_timestamp;
        question.bump = ctx.bumps.question;

        // Update counters
        question_bank.total_questions += 1;

        // Update user reputation for submission
        let user_reputation = &mut ctx.accounts.user_reputation;
        user_reputation.questions_submitted += 1;

        msg!(
            "Question submitted by: {}, ID: {}, Category: {}",
            question.submitter,
            question.id,
            question.category
        );
        
        Ok(())
    }

    /// Vote on a submitted question (approve or reject)
    /// Implements double-voting prevention and self-voting restriction
    pub fn vote_on_question(
        ctx: Context<VoteOnQuestion>,
        vote_type: VoteType,
    ) -> Result<()> {
        let question = &mut ctx.accounts.question;
        let voter = ctx.accounts.voter.key();
        
        // Ensure question is in pending status
        require!(
            question.status == QuestionStatus::Pending,
            QuestionBankError::QuestionNotPending
        );

        // Prevent users from voting on their own questions
        require!(
            question.submitter != voter,
            QuestionBankError::CannotVoteOnOwnQuestion
        );

        // Check for double voting
        require!(
            !question.voters.contains(&voter),
            QuestionBankError::AlreadyVoted
        );

        // Add voter to the list
        question.voters.push(voter);

        // Update vote counts
        match vote_type {
            VoteType::Approve => {
                question.votes_approve += 1;
            }
            VoteType::Reject => {
                question.votes_reject += 1;
            }
        }

        // Update voter's reputation
        let user_reputation = &mut ctx.accounts.user_reputation;
        user_reputation.curation_votes += 1;
        user_reputation.reputation_score += 10; // Small reward for participation

        msg!(
            "Vote recorded: {:?} by {} for question {}",
            vote_type,
            voter,
            question.id
        );

        Ok(())
    }

    /// Finalize a question's status based on votes
    /// Only approved curators can finalize questions
    pub fn finalize_question(
        ctx: Context<FinalizeQuestion>,
        question_id: u64,
    ) -> Result<()> {
        let question = &mut ctx.accounts.question;
        let question_bank = &mut ctx.accounts.question_bank;
        let curator = ctx.accounts.curator.key();
        
        // Verify that the caller is an approved curator
        require!(
            question_bank.curators.contains(&curator),
            QuestionBankError::UnauthorizedCurator
        );

        // Ensure question exists and is pending
        require!(
            question.id == question_id,
            QuestionBankError::QuestionNotFound
        );
        require!(
            question.status == QuestionStatus::Pending,
            QuestionBankError::QuestionNotPending
        );

        // Determine final status based on votes
        let total_votes = question.votes_approve + question.votes_reject;
        require!(total_votes >= 5, QuestionBankError::InsufficientVotes); // Minimum 5 votes required

        if question.votes_approve > question.votes_reject {
            question.status = QuestionStatus::Approved;
            question_bank.active_questions += 1;

            // Update submitter's reputation for approved question
            let submitter_reputation = &mut ctx.accounts.submitter_reputation;
            submitter_reputation.questions_approved += 1;
            submitter_reputation.reputation_score += 50; // Reward for approved question
        } else {
            question.status = QuestionStatus::Rejected;
            
            // Slight reputation penalty for rejected question
            let submitter_reputation = &mut ctx.accounts.submitter_reputation;
            if submitter_reputation.reputation_score > 10 {
                submitter_reputation.reputation_score -= 10;
            }
        }

        msg!(
            "Question {} finalized with status: {:?} by curator {}",
            question_id,
            question.status,
            curator
        );

        Ok(())
    }

    /// Update user reputation based on various actions
    /// Internal function called by other instructions
    pub fn update_reputation(
        ctx: Context<UpdateReputation>,
        action_type: ReputationAction,
    ) -> Result<()> {
        let user_reputation = &mut ctx.accounts.user_reputation;
        
        match action_type {
            ReputationAction::QuestionSubmitted => {
                user_reputation.questions_submitted += 1;
                user_reputation.reputation_score += 5;
            }
            ReputationAction::QuestionApproved => {
                user_reputation.questions_approved += 1;
                user_reputation.reputation_score += 50;
            }
            ReputationAction::QuestionRejected => {
                if user_reputation.reputation_score > 10 {
                    user_reputation.reputation_score -= 10;
                }
            }
            ReputationAction::VoteCast => {
                user_reputation.curation_votes += 1;
                user_reputation.reputation_score += 10;
            }
        }

        msg!(
            "Reputation updated for {}: action={:?}, new_score={}",
            user_reputation.user,
            action_type,
            user_reputation.reputation_score
        );

        Ok(())
    }

    /// Add a new curator to the Question Bank
    /// Only the authority can add curators
    pub fn add_curator(
        ctx: Context<AddCurator>,
        new_curator: Pubkey,
    ) -> Result<()> {
        let question_bank = &mut ctx.accounts.question_bank;
        
        // Verify authority
        require!(
            ctx.accounts.authority.key() == question_bank.authority,
            QuestionBankError::UnauthorizedAuthority
        );

        // Check if curator is already added
        require!(
            !question_bank.curators.contains(&new_curator),
            QuestionBankError::CuratorAlreadyExists
        );

        // Add curator
        question_bank.curators.push(new_curator);

        msg!("Curator added: {}", new_curator);
        Ok(())
    }

    /// Remove a curator from the Question Bank
    /// Only the authority can remove curators
    pub fn remove_curator(
        ctx: Context<RemoveCurator>,
        curator_to_remove: Pubkey,
    ) -> Result<()> {
        let question_bank = &mut ctx.accounts.question_bank;
        
        // Verify authority
        require!(
            ctx.accounts.authority.key() == question_bank.authority,
            QuestionBankError::UnauthorizedAuthority
        );

        // Cannot remove the authority itself
        require!(
            curator_to_remove != question_bank.authority,
            QuestionBankError::CannotRemoveAuthority
        );

        // Find and remove curator
        if let Some(pos) = question_bank.curators.iter().position(|&x| x == curator_to_remove) {
            question_bank.curators.remove(pos);
            msg!("Curator removed: {}", curator_to_remove);
        } else {
            return Err(QuestionBankError::CuratorNotFound.into());
        }

        Ok(())
    }

    /// Initialize user reputation account
    /// Called when a user first interacts with the system
    pub fn initialize_user_reputation(
        ctx: Context<InitializeUserReputation>,
    ) -> Result<()> {
        let user_reputation = &mut ctx.accounts.user_reputation;
        
        user_reputation.user = ctx.accounts.user.key();
        user_reputation.questions_submitted = 0;
        user_reputation.questions_approved = 0;
        user_reputation.curation_votes = 0;
        user_reputation.reputation_score = 100; // Starting reputation
        user_reputation.bump = ctx.bumps.user_reputation;

        msg!("User reputation initialized for: {}", user_reputation.user);
        Ok(())
    }

    /// Get approved questions for tournament use
    /// Returns question IDs filtered by category and difficulty
    pub fn get_approved_questions(
        ctx: Context<GetApprovedQuestions>,
        category: Option<String>,
        difficulty: Option<u8>,
    ) -> Result<Vec<u64>> {
        let question_bank = &ctx.accounts.question_bank;
        
        // In a production implementation, this would query a questions index
        // For now, return mock filtered question IDs
        let mut question_ids = Vec::new();
        
        // Simulate filtering logic
        for i in 0..question_bank.active_questions {
            // Add basic filtering logic here
            question_ids.push(i);
        }

        // Limit to reasonable number for gas costs
        question_ids.truncate(50);
        
        msg!(
            "Retrieved {} approved questions for category: {:?}, difficulty: {:?}",
            question_ids.len(),
            category,
            difficulty
        );

        Ok(question_ids)
    }
}

// ============================================================================
// Account Contexts
// ============================================================================

#[derive(Accounts)]
pub struct InitializeQuestionBank<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + QuestionBank::SPACE,
        seeds = [b"question_bank"],
        bump
    )]
    pub question_bank: Account<'info, QuestionBank>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitQuestion<'info> {
    #[account(
        init,
        payer = submitter,
        space = 8 + Question::SPACE,
        seeds = [b"question", question_bank.total_questions.to_le_bytes().as_ref()],
        bump
    )]
    pub question: Account<'info, Question>,
    
    #[account(
        mut,
        seeds = [b"question_bank"],
        bump = question_bank.bump
    )]
    pub question_bank: Account<'info, QuestionBank>,
    
    #[account(
        mut,
        seeds = [b"reputation", submitter.key().as_ref()],
        bump = user_reputation.bump
    )]
    pub user_reputation: Account<'info, UserReputation>,
    
    #[account(mut)]
    pub submitter: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VoteOnQuestion<'info> {
    #[account(
        mut,
        seeds = [b"question", question.id.to_le_bytes().as_ref()],
        bump = question.bump
    )]
    pub question: Account<'info, Question>,
    
    #[account(
        mut,
        seeds = [b"reputation", voter.key().as_ref()],
        bump = user_reputation.bump
    )]
    pub user_reputation: Account<'info, UserReputation>,
    
    #[account(mut)]
    pub voter: Signer<'info>,
}

#[derive(Accounts)]
pub struct FinalizeQuestion<'info> {
    #[account(
        mut,
        seeds = [b"question", question.id.to_le_bytes().as_ref()],
        bump = question.bump
    )]
    pub question: Account<'info, Question>,
    
    #[account(
        mut,
        seeds = [b"question_bank"],
        bump = question_bank.bump
    )]
    pub question_bank: Account<'info, QuestionBank>,
    
    #[account(
        mut,
        seeds = [b"reputation", question.submitter.as_ref()],
        bump = submitter_reputation.bump
    )]
    pub submitter_reputation: Account<'info, UserReputation>,
    
    pub curator: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateReputation<'info> {
    #[account(
        mut,
        seeds = [b"reputation", user_reputation.user.as_ref()],
        bump = user_reputation.bump
    )]
    pub user_reputation: Account<'info, UserReputation>,
}

#[derive(Accounts)]
pub struct AddCurator<'info> {
    #[account(
        mut,
        seeds = [b"question_bank"],
        bump = question_bank.bump
    )]
    pub question_bank: Account<'info, QuestionBank>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RemoveCurator<'info> {
    #[account(
        mut,
        seeds = [b"question_bank"],
        bump = question_bank.bump
    )]
    pub question_bank: Account<'info, QuestionBank>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeUserReputation<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + UserReputation::SPACE,
        seeds = [b"reputation", user.key().as_ref()],
        bump
    )]
    pub user_reputation: Account<'info, UserReputation>,
    
    /// CHECK: This is the user whose reputation is being initialized
    pub user: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetApprovedQuestions<'info> {
    #[account(
        seeds = [b"question_bank"],
        bump = question_bank.bump
    )]
    pub question_bank: Account<'info, QuestionBank>,
}

// ============================================================================
// Account Structures
// ============================================================================

#[account]
pub struct QuestionBank {
    pub authority: Pubkey,
    pub total_questions: u64,
    pub active_questions: u64,
    pub curators: Vec<Pubkey>,
    pub bump: u8,
}

impl QuestionBank {
    pub const SPACE: usize = 32 + 8 + 8 + (4 + 32 * 20) + 1; // Support up to 20 curators
}

#[account]
pub struct Question {
    pub id: u64,
    pub submitter: Pubkey,
    pub question_text: String,
    pub options: [String; 4],
    pub correct_answer: u8,
    pub category: String,
    pub difficulty: u8,
    pub votes_approve: u32,
    pub votes_reject: u32,
    pub voters: Vec<Pubkey>,
    pub status: QuestionStatus,
    pub created_at: i64,
    pub bump: u8,
}

impl Question {
    pub const SPACE: usize = 8 + 32 + 500 + (4 * 100) + 1 + 50 + 1 + 4 + 4 + (4 + 32 * 50) + 1 + 8 + 1; // Support up to 50 voters
}

#[account]
pub struct UserReputation {
    pub user: Pubkey,
    pub questions_submitted: u32,
    pub questions_approved: u32,
    pub curation_votes: u32,
    pub reputation_score: u64,
    pub bump: u8,
}

impl UserReputation {
    pub const SPACE: usize = 32 + 4 + 4 + 4 + 8 + 1;
}

// ============================================================================
// Data Structures
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct QuestionData {
    pub question_text: String,
    pub options: [String; 4],
    pub correct_answer: u8,
    pub category: String,
    pub difficulty: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Debug)]
pub enum QuestionStatus {
    Pending,
    Approved,
    Rejected,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum VoteType {
    Approve,
    Reject,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum ReputationAction {
    QuestionSubmitted,
    QuestionApproved,
    QuestionRejected,
    VoteCast,
}

// ============================================================================
// Error Codes
// ============================================================================

#[error_code]
pub enum QuestionBankError {
    #[msg("Invalid question format: check text length, options, or difficulty")]
    InvalidQuestionFormat = 6000,
    
    #[msg("Unauthorized curator: only approved curators can finalize questions")]
    UnauthorizedCurator = 6001,
    
    #[msg("Already voted: user has already voted on this question")]
    AlreadyVoted = 6002,
    
    #[msg("Question not found: invalid question ID")]
    QuestionNotFound = 6003,
    
    #[msg("Insufficient reputation: minimum reputation required to submit questions")]
    InsufficientReputation = 6004,
    
    #[msg("Question not pending: question is not in pending status")]
    QuestionNotPending = 6005,
    
    #[msg("Cannot vote on own question: users cannot vote on their own submissions")]
    CannotVoteOnOwnQuestion = 6006,
    
    #[msg("Insufficient votes: minimum number of votes required for finalization")]
    InsufficientVotes = 6007,
    
    #[msg("Unauthorized authority: only program authority can perform this action")]
    UnauthorizedAuthority = 6008,
    
    #[msg("Curator already exists: curator is already in the list")]
    CuratorAlreadyExists = 6009,
    
    #[msg("Curator not found: curator is not in the list")]
    CuratorNotFound = 6010,
    
    #[msg("Cannot remove authority: program authority cannot be removed as curator")]
    CannotRemoveAuthority = 6011,
}