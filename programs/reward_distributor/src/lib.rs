use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("EDy3LJ7eDf8UbpdsikwejxEDPxk48spTG3rwdzuM5TFd");

#[program]
pub mod reward_distributor {
    use super::*;

    /// Create a new reward pool for distribution
    /// Supports multiple reward types and distribution criteria
    pub fn create_reward_pool(
        ctx: Context<CreateRewardPool>,
        pool_data: CreateRewardPoolData,
        initial_funding: u64,
    ) -> Result<()> {
        // Validate pool data
        require!(pool_data.name.len() <= 50, RewardDistributorError::InvalidPoolName);
        require!(pool_data.start_time > Clock::get()?.unix_timestamp, RewardDistributorError::InvalidStartTime);
        require!(pool_data.end_time > pool_data.start_time, RewardDistributorError::InvalidEndTime);
        require!(pool_data.total_rewards > 0, RewardDistributorError::InvalidRewardAmount);

        let reward_pool = &mut ctx.accounts.reward_pool;
        
        // Initialize reward pool
        reward_pool.id = pool_data.id;
        reward_pool.authority = ctx.accounts.authority.key();
        reward_pool.name = pool_data.name;
        reward_pool.total_rewards = pool_data.total_rewards;
        reward_pool.distributed_rewards = 0;
        reward_pool.reward_type = pool_data.reward_type.clone();
        reward_pool.token_mint = pool_data.token_mint;
        reward_pool.distribution_criteria = pool_data.distribution_criteria;
        reward_pool.start_time = pool_data.start_time;
        reward_pool.end_time = pool_data.end_time;
        reward_pool.active = true;
        reward_pool.bump = ctx.bumps.reward_pool;

        // Handle initial funding based on reward type
        if initial_funding > 0 {
            match &pool_data.reward_type {
                RewardType::SOL => {
                    // Transfer SOL from authority to vault
                    let cpi_context = CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        anchor_framework::system_program::Transfer {
                            from: ctx.accounts.authority.to_account_info(),
                            to: ctx.accounts.reward_vault.to_account_info(),
                        },
                    );
                    anchor_framework::system_program::transfer(cpi_context, initial_funding)?;
                }
                RewardType::SplToken => {
                    // Transfer SPL tokens from authority to vault
                    require!(pool_data.token_mint.is_some(), RewardDistributorError::MissingTokenMint);
                    
                    let cpi_accounts = Transfer {
                        from: ctx.accounts.authority_token_account.as_ref().unwrap().to_account_info(),
                        to: ctx.accounts.reward_vault_token.as_ref().unwrap().to_account_info(),
                        authority: ctx.accounts.authority.to_account_info(),
                    };
                    let cpi_program = ctx.accounts.token_program.as_ref().unwrap().to_account_info();
                    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
                    
                    token::transfer(cpi_ctx, initial_funding)?;
                }
                RewardType::NFT => {
                    // NFT handling would be implemented here
                    // For now, mark as unsupported in initial funding
                    require!(initial_funding == 0, RewardDistributorError::NFTFundingUnsupported);
                }
            }
        }

        msg!(
            "Reward pool created: ID={}, Name={}, Type={:?}, Total={}",
            pool_data.id,
            pool_data.name,
            pool_data.reward_type,
            pool_data.total_rewards
        );

        Ok(())
    }

    /// Fund an existing reward pool with additional rewards
    pub fn fund_reward_pool(
        ctx: Context<FundRewardPool>,
        pool_id: u64,
        amount: u64,
    ) -> Result<()> {
        let reward_pool = &mut ctx.accounts.reward_pool;
        
        require!(reward_pool.id == pool_id, RewardDistributorError::PoolNotFound);
        require!(reward_pool.active, RewardDistributorError::PoolNotActive);
        require!(amount > 0, RewardDistributorError::InvalidRewardAmount);

        // Handle funding based on reward type
        match &reward_pool.reward_type {
            RewardType::SOL => {
                let cpi_context = CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_framework::system_program::Transfer {
                        from: ctx.accounts.funder.to_account_info(),
                        to: ctx.accounts.reward_vault.to_account_info(),
                    },
                );
                anchor_framework::system_program::transfer(cpi_context, amount)?;
            }
            RewardType::SplToken => {
                let cpi_accounts = Transfer {
                    from: ctx.accounts.funder_token_account.as_ref().unwrap().to_account_info(),
                    to: ctx.accounts.reward_vault_token.as_ref().unwrap().to_account_info(),
                    authority: ctx.accounts.funder.to_account_info(),
                };
                let cpi_program = ctx.accounts.token_program.as_ref().unwrap().to_account_info();
                let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
                
                token::transfer(cpi_ctx, amount)?;
            }
            RewardType::NFT => {
                return Err(RewardDistributorError::NFTFundingUnsupported.into());
            }
        }

        reward_pool.total_rewards += amount;

        msg!("Pool {} funded with {} additional rewards", pool_id, amount);
        Ok(())
    }

    /// Calculate user rewards based on performance data and distribution criteria
    /// Integrates with Honeycomb Protocol for user data verification
    pub fn calculate_user_rewards(
        ctx: Context<CalculateUserRewards>,
        pool_id: u64,
        performance_data: PerformanceData,
    ) -> Result<u64> {
        let reward_pool = &ctx.accounts.reward_pool;
        let user_claim = &mut ctx.accounts.user_claim;
        
        require!(reward_pool.id == pool_id, RewardDistributorError::PoolNotFound);
        require!(reward_pool.active, RewardDistributorError::PoolNotActive);
        
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time >= reward_pool.start_time, RewardDistributorError::ClaimPeriodNotStarted);
        require!(current_time <= reward_pool.end_time, RewardDistributorError::ClaimPeriodEnded);

        // Validate performance data
        require!(
            performance_data.validate(),
            RewardDistributorError::InvalidPerformanceData
        );

        // Calculate rewards based on distribution criteria
        let calculated_reward = match &reward_pool.distribution_criteria {
            DistributionType::EqualShare => {
                // Simple equal distribution - would need total eligible users count
                reward_pool.total_rewards / 100 // Placeholder calculation
            }
            DistributionType::PerformanceBased => {
                calculate_performance_rewards(reward_pool, &performance_data)?
            }
            DistributionType::StakingRewards => {
                calculate_staking_rewards(reward_pool, &performance_data)?
            }
            DistributionType::AchievementBased => {
                calculate_achievement_rewards(reward_pool, &performance_data)?
            }
            DistributionType::RandomDrop => {
                calculate_random_rewards(reward_pool, &performance_data)?
            }
        };

        // Update user claim record
        if user_claim.pool == Pubkey::default() {
            // Initialize claim record
            user_claim.pool = reward_pool.key();
            user_claim.user = ctx.accounts.user.key();
            user_claim.amount_claimed = 0;
            user_claim.last_claim_time = 0;
            user_claim.total_eligible = calculated_reward;
            user_claim.bump = ctx.bumps.user_claim;
        } else {
            // Update existing record
            user_claim.total_eligible = calculated_reward;
        }

        msg!(
            "Calculated reward for user {}: {} (Pool: {})",
            ctx.accounts.user.key(),
            calculated_reward,
            pool_id
        );

        Ok(calculated_reward)
    }

    /// Claim available rewards for a user
    pub fn claim_rewards(
        ctx: Context<ClaimRewards>,
        pool_id: u64,
    ) -> Result<()> {
        let reward_pool = &mut ctx.accounts.reward_pool;
        let user_claim = &mut ctx.accounts.user_claim;
        
        require!(reward_pool.id == pool_id, RewardDistributorError::PoolNotFound);
        require!(reward_pool.active, RewardDistributorError::PoolNotActive);
        require!(user_claim.pool == reward_pool.key(), RewardDistributorError::InvalidClaimRecord);
        
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time >= reward_pool.start_time, RewardDistributorError::ClaimPeriodNotStarted);
        require!(current_time <= reward_pool.end_time, RewardDistributorError::ClaimPeriodEnded);

        // Calculate claimable amount
        let claimable_amount = user_claim.total_eligible - user_claim.amount_claimed;
        require!(claimable_amount > 0, RewardDistributorError::NothingToClaim);
        require!(
            reward_pool.total_rewards >= reward_pool.distributed_rewards + claimable_amount,
            RewardDistributorError::InsufficientPoolFunds
        );

        // Distribute rewards based on type
        match &reward_pool.reward_type {
            RewardType::SOL => {
                // Transfer SOL from vault to user
                let seeds = &[
                    b"reward_vault",
                    &pool_id.to_le_bytes(),
                    &[ctx.accounts.reward_vault.bump],
                ];
                let signer = &[&seeds[..]];

                let cpi_context = CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_framework::system_program::Transfer {
                        from: ctx.accounts.reward_vault.to_account_info(),
                        to: ctx.accounts.user.to_account_info(),
                    },
                    signer,
                );
                anchor_framework::system_program::transfer(cpi_context, claimable_amount)?;
            }
            RewardType::SplToken => {
                // Transfer SPL tokens from vault to user
                let seeds = &[
                    b"reward_vault",
                    &pool_id.to_le_bytes(),
                    &[ctx.accounts.reward_vault.bump],
                ];
                let signer = &[&seeds[..]];

                let cpi_accounts = Transfer {
                    from: ctx.accounts.reward_vault_token.as_ref().unwrap().to_account_info(),
                    to: ctx.accounts.user_token_account.as_ref().unwrap().to_account_info(),
                    authority: ctx.accounts.reward_vault.to_account_info(),
                };
                let cpi_program = ctx.accounts.token_program.as_ref().unwrap().to_account_info();
                let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
                
                token::transfer(cpi_ctx, claimable_amount)?;
            }
            RewardType::NFT => {
                // NFT transfer logic would be implemented here
                return Err(RewardDistributorError::NFTClaimUnsupported.into());
            }
        }

        // Update records
        user_claim.amount_claimed += claimable_amount;
        user_claim.last_claim_time = current_time;
        reward_pool.distributed_rewards += claimable_amount;

        msg!(
            "User {} claimed {} rewards from pool {}",
            ctx.accounts.user.key(),
            claimable_amount,
            pool_id
        );

        Ok(())
    }

    /// Update distribution criteria for a reward pool (authority only)
    pub fn update_distribution_criteria(
        ctx: Context<UpdateDistributionCriteria>,
        pool_id: u64,
        new_criteria: DistributionType,
    ) -> Result<()> {
        let reward_pool = &mut ctx.accounts.reward_pool;
        
        require!(reward_pool.id == pool_id, RewardDistributorError::PoolNotFound);
        require!(reward_pool.authority == ctx.accounts.authority.key(), RewardDistributorError::UnauthorizedAuthority);
        
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time < reward_pool.start_time, RewardDistributorError::CannotUpdateActivePool);

        reward_pool.distribution_criteria = new_criteria;

        msg!("Updated distribution criteria for pool {}", pool_id);
        Ok(())
    }

    /// Close a reward pool and return remaining funds (authority only)
    pub fn close_reward_pool(
        ctx: Context<CloseRewardPool>,
        pool_id: u64,
    ) -> Result<()> {
        let reward_pool = &mut ctx.accounts.reward_pool;
        
        require!(reward_pool.id == pool_id, RewardDistributorError::PoolNotFound);
        require!(reward_pool.authority == ctx.accounts.authority.key(), RewardDistributorError::UnauthorizedAuthority);
        
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time > reward_pool.end_time, RewardDistributorError::PoolStillActive);

        // Calculate remaining funds
        let remaining_funds = reward_pool.total_rewards - reward_pool.distributed_rewards;
        
        if remaining_funds > 0 {
            // Return remaining funds to authority
            match &reward_pool.reward_type {
                RewardType::SOL => {
                    let seeds = &[
                        b"reward_vault",
                        &pool_id.to_le_bytes(),
                        &[ctx.accounts.reward_vault.bump],
                    ];
                    let signer = &[&seeds[..]];

                    let cpi_context = CpiContext::new_with_signer(
                        ctx.accounts.system_program.to_account_info(),
                        anchor_framework::system_program::Transfer {
                            from: ctx.accounts.reward_vault.to_account_info(),
                            to: ctx.accounts.authority.to_account_info(),
                        },
                        signer,
                    );
                    anchor_framework::system_program::transfer(cpi_context, remaining_funds)?;
                }
                RewardType::SplToken => {
                    let seeds = &[
                        b"reward_vault",
                        &pool_id.to_le_bytes(),
                        &[ctx.accounts.reward_vault.bump],
                    ];
                    let signer = &[&seeds[..]];

                    let cpi_accounts = Transfer {
                        from: ctx.accounts.reward_vault_token.as_ref().unwrap().to_account_info(),
                        to: ctx.accounts.authority_token_account.as_ref().unwrap().to_account_info(),
                        authority: ctx.accounts.reward_vault.to_account_info(),
                    };
                    let cpi_program = ctx.accounts.token_program.as_ref().unwrap().to_account_info();
                    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
                    
                    token::transfer(cpi_ctx, remaining_funds)?;
                }
                RewardType::NFT => {
                    // NFT return logic would be implemented here
                }
            }
        }

        reward_pool.active = false;

        msg!("Pool {} closed, returned {} remaining funds", pool_id, remaining_funds);
        Ok(())
    }

    /// Verify Honeycomb achievements for reward eligibility
    pub fn verify_honeycomb_achievements(
        ctx: Context<VerifyHoneycombAchievements>,
        pool_id: u64,
        achievement_data: HoneycombAchievementData,
    ) -> Result<bool> {
        let reward_pool = &ctx.accounts.reward_pool;
        
        require!(reward_pool.id == pool_id, RewardDistributorError::PoolNotFound);
        
        // Verify achievement data against Honeycomb Protocol
        let is_valid = verify_honeycomb_data(&achievement_data, &ctx.accounts.honeycomb_profile)?;
        
        msg!(
            "Honeycomb achievement verification for user {}: {}",
            ctx.accounts.user.key(),
            is_valid
        );

        Ok(is_valid)
    }

    /// Get user's claimable rewards amount
    pub fn get_claimable_amount(
        ctx: Context<GetClaimableAmount>,
        pool_id: u64,
    ) -> Result<u64> {
        let reward_pool = &ctx.accounts.reward_pool;
        let user_claim = &ctx.accounts.user_claim;
        
        require!(reward_pool.id == pool_id, RewardDistributorError::PoolNotFound);
        
        if user_claim.pool == Pubkey::default() {
            return Ok(0);
        }

        let claimable = user_claim.total_eligible - user_claim.amount_claimed;
        Ok(claimable)
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

fn calculate_performance_rewards(
    reward_pool: &RewardPool,
    performance_data: &PerformanceData,
) -> Result<u64> {
    // Calculate rewards based on performance metrics
    let base_reward = reward_pool.total_rewards / 1000; // Base 0.1% of total pool
    
    let performance_multiplier = match performance_data.score {
        0..=50 => 1,
        51..=75 => 2,
        76..=90 => 3,
        91..=99 => 4,
        100 => 5,
        _ => 1,
    };

    let time_bonus = if performance_data.completion_time > 0 {
        // Faster completion gets bonus (simplified)
        std::cmp::max(1, 120 - performance_data.completion_time / 60) as u64
    } else {
        1
    };

    let calculated_reward = base_reward * performance_multiplier * time_bonus / 100;
    
    // Cap at maximum per-user allocation (10% of total pool)
    let max_reward = reward_pool.total_rewards / 10;
    Ok(std::cmp::min(calculated_reward, max_reward))
}

fn calculate_staking_rewards(
    reward_pool: &RewardPool,
    performance_data: &PerformanceData,
) -> Result<u64> {
    // Calculate rewards based on staking duration
    let base_reward = reward_pool.total_rewards / 365; // Daily allocation
    
    let staking_days = performance_data.staking_duration / (24 * 60 * 60); // Convert seconds to days
    let calculated_reward = base_reward * staking_days;
    
    // Cap at maximum allocation
    let max_reward = reward_pool.total_rewards / 10;
    Ok(std::cmp::min(calculated_reward, max_reward))
}

fn calculate_achievement_rewards(
    reward_pool: &RewardPool,
    performance_data: &PerformanceData,
) -> Result<u64> {
    // Calculate rewards based on achievements unlocked
    let base_reward = reward_pool.total_rewards / 100; // Base 1% per achievement
    
    let achievement_multiplier = performance_data.achievements_unlocked;
    let calculated_reward = base_reward * achievement_multiplier as u64;
    
    // Cap at maximum allocation
    let max_reward = reward_pool.total_rewards / 5; // Max 20%
    Ok(std::cmp::min(calculated_reward, max_reward))
}

fn calculate_random_rewards(
    reward_pool: &RewardPool,
    performance_data: &PerformanceData,
) -> Result<u64> {
    // Random drop calculation (simplified)
    let seed = performance_data.random_seed;
    let random_value = (seed % 100) as u64;
    
    if random_value < 10 {
        // 10% chance for rewards
        let base_reward = reward_pool.total_rewards / 50; // 2% of total pool
        Ok(base_reward)
    } else {
        Ok(0)
    }
}

fn verify_honeycomb_data(
    achievement_data: &HoneycombAchievementData,
    honeycomb_profile: &AccountInfo,
) -> Result<bool> {
    // Placeholder for Honeycomb Protocol integration
    // In production, this would verify data against Honeycomb's on-chain records
    
    // Basic validation for now
    require!(
        achievement_data.profile_owner == *honeycomb_profile.key,
        RewardDistributorError::InvalidHoneycombProfile
    );
    
    require!(
        achievement_data.achievements.len() <= 100,
        RewardDistributorError::TooManyAchievements
    );

    // Verify achievement signatures or on-chain proofs
    for achievement in &achievement_data.achievements {
        require!(
            achievement.timestamp > 0,
            RewardDistributorError::InvalidAchievementData
        );
    }

    Ok(true)
}

// ============================================================================
// Account Contexts
// ============================================================================

#[derive(Accounts)]
#[instruction(pool_data: CreateRewardPoolData)]
pub struct CreateRewardPool<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + RewardPool::SPACE,
        seeds = [b"pool", &pool_data.id.to_le_bytes()],
        bump
    )]
    pub reward_pool: Account<'info, RewardPool>,

    #[account(
        init,
        payer = authority,
        space = 8 + RewardVault::SPACE,
        seeds = [b"reward_vault", &pool_data.id.to_le_bytes()],
        bump
    )]
    pub reward_vault: Account<'info, RewardVault>,

    #[account(mut)]
    pub authority: Signer<'info>,

    // Optional token accounts for SPL token rewards
    #[account(mut)]
    pub authority_token_account: Option<Account<'info, TokenAccount>>,
    
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = token_mint,
        associated_token::authority = reward_vault
    )]
    pub reward_vault_token: Option<Account<'info, TokenAccount>>,

    pub token_mint: Option<Account<'info, Mint>>,
    pub token_program: Option<Program<'info, Token>>,
    pub associated_token_program: Option<Program<'info, AssociatedToken>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct FundRewardPool<'info> {
    #[account(
        mut,
        seeds = [b"pool", &pool_id.to_le_bytes()],
        bump = reward_pool.bump
    )]
    pub reward_pool: Account<'info, RewardPool>,

    #[account(
        seeds = [b"reward_vault", &pool_id.to_le_bytes()],
        bump = reward_vault.bump
    )]
    pub reward_vault: Account<'info, RewardVault>,

    #[account(mut)]
    pub funder: Signer<'info>,

    // Optional token accounts for SPL token funding
    #[account(mut)]
    pub funder_token_account: Option<Account<'info, TokenAccount>>,
    
    #[account(mut)]
    pub reward_vault_token: Option<Account<'info, TokenAccount>>,

    pub token_program: Option<Program<'info, Token>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct CalculateUserRewards<'info> {
    #[account(
        seeds = [b"pool", &pool_id.to_le_bytes()],
        bump = reward_pool.bump
    )]
    pub reward_pool: Account<'info, RewardPool>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserClaim::SPACE,
        seeds = [b"claim", &pool_id.to_le_bytes(), user.key().as_ref()],
        bump
    )]
    pub user_claim: Account<'info, UserClaim>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: Honeycomb profile account for verification
    pub honeycomb_profile: Option<UncheckedAccount<'info>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct ClaimRewards<'info> {
    #[account(
        mut,
        seeds = [b"pool", &pool_id.to_le_bytes()],
        bump = reward_pool.bump
    )]
    pub reward_pool: Account<'info, RewardPool>,

    #[account(
        mut,
        seeds = [b"claim", &pool_id.to_le_bytes(), user.key().as_ref()],
        bump = user_claim.bump
    )]
    pub user_claim: Account<'info, UserClaim>,

    #[account(
        mut,
        seeds = [b"reward_vault", &pool_id.to_le_bytes()],
        bump = reward_vault.bump
    )]
    pub reward_vault: Account<'info, RewardVault>,

    #[account(mut)]
    pub user: Signer<'info>,

    // Optional token accounts for SPL token claims
    #[account(mut)]
    pub user_token_account: Option<Account<'info, TokenAccount>>,
    
    #[account(mut)]
    pub reward_vault_token: Option<Account<'info, TokenAccount>>,

    pub token_program: Option<Program<'info, Token>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct UpdateDistributionCriteria<'info> {
    #[account(
        mut,
        seeds = [b"pool", &pool_id.to_le_bytes()],
        bump = reward_pool.bump,
        has_one = authority
    )]
    pub reward_pool: Account<'info, RewardPool>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct CloseRewardPool<'info> {
    #[account(
        mut,
        seeds = [b"pool", &pool_id.to_le_bytes()],
        bump = reward_pool.bump,
        has_one = authority
    )]
    pub reward_pool: Account<'info, RewardPool>,

    #[account(
        mut,
        seeds = [b"reward_vault", &pool_id.to_le_bytes()],
        bump = reward_vault.bump
    )]
    pub reward_vault: Account<'info, RewardVault>,

    #[account(mut)]
    pub authority: Signer<'info>,

    // Optional token accounts for returning SPL tokens
    #[account(mut)]
    pub authority_token_account: Option<Account<'info, TokenAccount>>,
    
    #[account(mut)]
    pub reward_vault_token: Option<Account<'info, TokenAccount>>,

    pub token_program: Option<Program<'info, Token>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct VerifyHoneycombAchievements<'info> {
    #[account(
        seeds = [b"pool", &pool_id.to_le_bytes()],
        bump = reward_pool.bump
    )]
    pub reward_pool: Account<'info, RewardPool>,

    pub user: Signer<'info>,

    /// CHECK: Honeycomb profile account for verification
    pub honeycomb_profile: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(pool_id: u64)]
pub struct GetClaimableAmount<'info> {
    #[account(
        seeds = [b"pool", &pool_id.to_le_bytes()],
        bump = reward_pool.bump
    )]
    pub reward_pool: Account<'info, RewardPool>,

    #[account(
        seeds = [b"claim", &pool_id.to_le_bytes(), user.key().as_ref()],
        bump = user_claim.bump
    )]
    pub user_claim: Account<'info, UserClaim>,

    /// CHECK: User for claim lookup
    pub user: UncheckedAccount<'info>,
}

// ============================================================================
// Account Structures
// ============================================================================

#[account]
pub struct RewardPool {
    pub id: u64,
    pub authority: Pubkey,
    pub name: String,
    pub total_rewards: u64,
    pub distributed_rewards: u64,
    pub reward_type: RewardType,
    pub token_mint: Option<Pubkey>,
    pub distribution_criteria: DistributionType,
    pub start_time: i64,
    pub end_time: i64,
    pub active: bool,
    pub bump: u8,
}

impl RewardPool {
    pub const SPACE: usize = 8 + 32 + 50 + 8 + 8 + (1 + 33) + (1 + 32) + (1 + 8) + 8 + 8 + 1 + 1;
}

#[account]
pub struct UserClaim {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub amount_claimed: u64,
    pub last_claim_time: i64,
    pub total_eligible: u64,
    pub bump: u8,
}

impl UserClaim {
    pub const SPACE: usize = 32 + 32 + 8 + 8 + 8 + 1;
}

#[account]
pub struct RewardVault {
    pub pool: Pubkey,
    pub bump: u8,
}

impl RewardVault {
    pub const SPACE: usize = 32 + 1;
}

// ============================================================================
// Data Structures
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateRewardPoolData {
    pub id: u64,
    pub name: String,
    pub total_rewards: u64,
    pub reward_type: RewardType,
    pub token_mint: Option<Pubkey>,
    pub distribution_criteria: DistributionType,
    pub start_time: i64,
    pub end_time: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum RewardType {
    SOL,
    SplToken,
    NFT,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum DistributionType {
    EqualShare,
    PerformanceBased,
    StakingRewards,
    AchievementBased,
    RandomDrop,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PerformanceData {
    pub score: u32,
    pub completion_time: i64,
    pub staking_duration: i64,
    pub achievements_unlocked: u32,
    pub random_seed: u64,
    pub honeycomb_profile: Option<Pubkey>,
}

impl PerformanceData {
    pub fn validate(&self) -> bool {
        self.score <= 100 &&
        self.completion_time >= 0 &&
        self.staking_duration >= 0 &&
        self.achievements_unlocked <= 1000
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct HoneycombAchievementData {
    pub profile_owner: Pubkey,
    pub achievements: Vec<Achievement>,
    pub total_score: u64,
    pub completion_rate: u32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Achievement {
    pub id: String,
    pub name: String,
    pub description: String,
    pub points: u32,
    pub timestamp: i64,
    pub verified: bool,
}

// ============================================================================
// Error Codes
// ============================================================================

#[error_code]
pub enum RewardDistributorError {
    #[msg("Pool not found with the given ID")]
    PoolNotFound = 6200,
    
    #[msg("Insufficient funds in the reward pool")]
    InsufficientPoolFunds = 6201,
    
    #[msg("Claim period has ended for this pool")]
    ClaimPeriodEnded = 6202,
    
    #[msg("User has already claimed maximum rewards")]
    AlreadyClaimed = 6203,
    
    #[msg("Invalid performance data provided")]
    InvalidPerformanceData = 6204,
    
    #[msg("Invalid pool name (max 50 characters)")]
    InvalidPoolName = 6205,
    
    #[msg("Invalid start time (must be in future)")]
    InvalidStartTime = 6206,
    
    #[msg("Invalid end time (must be after start time)")]
    InvalidEndTime = 6207,
    
    #[msg("Invalid reward amount")]
    InvalidRewardAmount = 6208,
    
    #[msg("Missing token mint for SPL token rewards")]
    MissingTokenMint = 6209,
    
    #[msg("NFT funding not supported in this version")]
    NFTFundingUnsupported = 6210,
    
    #[msg("Pool is not active")]
    PoolNotActive = 6211,
    
    #[msg("Claim period has not started yet")]
    ClaimPeriodNotStarted = 6212,
    
    #[msg("Invalid claim record for user")]
    InvalidClaimRecord = 6213,
    
    #[msg("Nothing to claim")]
    NothingToClaim = 6214,
    
    #[msg("NFT claiming not supported in this version")]
    NFTClaimUnsupported = 6215,
    
    #[msg("Unauthorized authority")]
    UnauthorizedAuthority = 6216,
    
    #[msg("Cannot update active pool")]
    CannotUpdateActivePool = 6217,
    
    #[msg("Pool is still active")]
    PoolStillActive = 6218,
    
    #[msg("Invalid Honeycomb profile")]
    InvalidHoneycombProfile = 6219,
    
    #[msg("Too many achievements")]
    TooManyAchievements = 6220,
    
    #[msg("Invalid achievement data")]
    InvalidAchievementData = 6221,
}