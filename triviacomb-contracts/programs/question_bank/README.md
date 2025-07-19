# Question Bank Smart Contract

A comprehensive Solana smart contract for community-driven trivia question submission, curation, and validation using the Anchor framework.

## 🎯 Overview

The Question Bank contract enables:
- **Community Question Submission**: Users submit trivia questions for review
- **Decentralized Curation**: Community voting on question quality
- **Reputation System**: Track user contributions and build trust
- **Quality Control**: Curator approval system with vote thresholds
- **Tournament Integration**: Approved questions feed into tournaments

## 📋 Contract Specifications

### Account Structures

#### QuestionBank (PDA)
Global program state and configuration.

```rust
pub struct QuestionBank {
    pub authority: Pubkey,        // Program authority
    pub total_questions: u64,     // Total questions submitted
    pub active_questions: u64,    // Approved questions count
    pub curators: Vec<Pubkey>,    // Approved curator list
    pub bump: u8,                 // PDA bump seed
}
```

#### Question (PDA: ["question", question_id])
Individual question data and voting information.

```rust
pub struct Question {
    pub id: u64,                  // Unique question identifier
    pub submitter: Pubkey,        // Question submitter
    pub question_text: String,    // Question text (max 500 chars)
    pub options: [String; 4],     // Answer options (max 100 chars each)
    pub correct_answer: u8,       // Correct answer index (0-3)
    pub category: String,         // Question category (max 50 chars)
    pub difficulty: u8,           // Difficulty level (1=easy, 2=medium, 3=hard)
    pub votes_approve: u32,       // Approval votes count
    pub votes_reject: u32,        // Rejection votes count
    pub voters: Vec<Pubkey>,      // List of voters (prevents double voting)
    pub status: QuestionStatus,   // Current status (Pending/Approved/Rejected)
    pub created_at: i64,          // Creation timestamp
    pub bump: u8,                 // PDA bump seed
}
```

#### UserReputation (PDA: ["reputation", user])
Track user contributions and reputation score.

```rust
pub struct UserReputation {
    pub user: Pubkey,             // User public key
    pub questions_submitted: u32,  // Total questions submitted
    pub questions_approved: u32,   // Questions that got approved
    pub curation_votes: u32,      // Total curation votes cast
    pub reputation_score: u64,    // Current reputation score
    pub bump: u8,                 // PDA bump seed
}
```

### Enums

```rust
pub enum QuestionStatus {
    Pending,    // Awaiting community review
    Approved,   // Approved for tournament use
    Rejected,   // Rejected by community/curator
}

pub enum VoteType {
    Approve,    // Vote to approve question
    Reject,     // Vote to reject question
}

pub enum ReputationAction {
    QuestionSubmitted,  // +5 reputation
    QuestionApproved,   // +50 reputation
    QuestionRejected,   // -10 reputation
    VoteCast,          // +10 reputation
}
```

## 🔧 Instructions

### 1. initialize_question_bank
Initialize the Question Bank program with authority.

```rust
pub fn initialize_question_bank(
    ctx: Context<InitializeQuestionBank>,
    authority: Pubkey,
) -> Result<()>
```

**Requirements:**
- Only called once during program deployment
- Authority becomes the first curator

### 2. submit_question
Submit a new trivia question for community review.

```rust
pub fn submit_question(
    ctx: Context<SubmitQuestion>,
    question_data: QuestionData,
) -> Result<()>
```

**Requirements:**
- User must have minimum 100 reputation
- Question text ≤ 500 characters
- Each option ≤ 100 characters
- Category ≤ 50 characters
- Difficulty between 1-3
- Correct answer index 0-3

**Effects:**
- Creates new Question account
- Increments user's questions_submitted
- Increments total_questions counter

### 3. vote_on_question
Vote to approve or reject a pending question.

```rust
pub fn vote_on_question(
    ctx: Context<VoteOnQuestion>,
    vote_type: VoteType,
) -> Result<()>
```

**Requirements:**
- Question must be in Pending status
- User cannot vote on own questions
- User cannot vote twice on same question
- User must have reputation account

**Effects:**
- Adds user to voters list
- Increments appropriate vote counter
- Increases voter's reputation by 10

### 4. finalize_question
Finalize question status based on community votes.

```rust
pub fn finalize_question(
    ctx: Context<FinalizeQuestion>,
    question_id: u64,
) -> Result<()>
```

**Requirements:**
- Only approved curators can call
- Question must be Pending
- Minimum 5 total votes required
- Question ID must match

**Effects:**
- Sets status to Approved/Rejected based on vote majority
- Updates active_questions counter if approved
- Adjusts submitter's reputation (+50 approved, -10 rejected)

### 5. add_curator
Add a new curator to the Question Bank.

```rust
pub fn add_curator(
    ctx: Context<AddCurator>,
    new_curator: Pubkey,
) -> Result<()>
```

**Requirements:**
- Only program authority can call
- Curator must not already exist

### 6. remove_curator
Remove a curator from the Question Bank.

```rust
pub fn remove_curator(
    ctx: Context<RemoveCurator>,
    curator_to_remove: Pubkey,
) -> Result<()>
```

**Requirements:**
- Only program authority can call
- Cannot remove the authority itself
- Curator must exist in list

### 7. initialize_user_reputation
Initialize reputation tracking for a new user.

```rust
pub fn initialize_user_reputation(
    ctx: Context<InitializeUserReputation>,
) -> Result<()>
```

**Effects:**
- Creates UserReputation account
- Sets starting reputation to 100

### 8. get_approved_questions
Retrieve approved questions for tournament use.

```rust
pub fn get_approved_questions(
    ctx: Context<GetApprovedQuestions>,
    category: Option<String>,
    difficulty: Option<u8>,
) -> Result<Vec<u64>>
```

**Returns:** Array of question IDs matching filters

## 🛡️ Security Features

### Access Control
- **Curator Verification**: Only approved curators can finalize questions
- **Authority Control**: Only program authority can manage curators
- **Self-Voting Prevention**: Users cannot vote on their own questions
- **Double-Voting Prevention**: Users cannot vote twice on same question

### Input Validation
- **String Length Limits**: Prevents excessive storage costs
- **Range Validation**: Difficulty levels and answer indices
- **Reputation Requirements**: Minimum reputation to submit questions
- **Vote Thresholds**: Minimum votes required for finalization

### Economic Security
- **Reputation System**: Incentivizes quality contributions
- **Sybil Resistance**: Reputation requirements prevent spam
- **Community Consensus**: Multiple votes required for approval

## 🔢 Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | InvalidQuestionFormat | Question format validation failed |
| 6001 | UnauthorizedCurator | Non-curator tried to finalize |
| 6002 | AlreadyVoted | User already voted on question |
| 6003 | QuestionNotFound | Invalid question ID |
| 6004 | InsufficientReputation | Below minimum reputation |
| 6005 | QuestionNotPending | Question not in pending status |
| 6006 | CannotVoteOnOwnQuestion | Self-voting attempt |
| 6007 | InsufficientVotes | Below minimum vote threshold |
| 6008 | UnauthorizedAuthority | Non-authority access attempt |
| 6009 | CuratorAlreadyExists | Duplicate curator addition |
| 6010 | CuratorNotFound | Curator not in list |
| 6011 | CannotRemoveAuthority | Cannot remove program authority |

## 💾 Storage Costs

### Account Sizes
- **QuestionBank**: 689 bytes (supports 20 curators)
- **Question**: 2,249 bytes (supports 50 voters)
- **UserReputation**: 53 bytes

### Rent Costs (approx.)
- **QuestionBank**: ~0.0048 SOL
- **Question**: ~0.016 SOL per question
- **UserReputation**: ~0.0004 SOL per user

## 🎮 Usage Examples

### TypeScript Client Usage

```typescript
import { QuestionBankClient } from './client/question_bank_client';

// Initialize client
const client = createQuestionBankClient("devnet", wallet);

// Submit a question
const questionData = {
  questionText: "What is the capital of France?",
  options: ["London", "Berlin", "Paris", "Madrid"],
  correctAnswer: 2,
  category: "Geography",
  difficulty: 2,
};

const { tx, questionId } = await client.submitQuestion(questionData, userKeypair);

// Vote on question
await client.voteOnQuestion(questionId, true, voterKeypair);

// Finalize question (curator only)
await client.finalizeQuestion(questionId, curatorKeypair);

// Get approved questions
const approvedQuestions = await client.getApprovedQuestions("Geography", 2);
```

### Rust Integration

```rust
use question_bank::{QuestionData, VoteType};

// Submit question
let question_data = QuestionData {
    question_text: "What is 2 + 2?".to_string(),
    options: ["3".to_string(), "4".to_string(), "5".to_string(), "6".to_string()],
    correct_answer: 1,
    category: "Math".to_string(),
    difficulty: 1,
};

let accounts = SubmitQuestion {
    question: question_pda,
    question_bank: question_bank_pda,
    user_reputation: user_reputation_pda,
    submitter: user.key(),
    system_program: system_program::ID,
};

question_bank::cpi::submit_question(
    CpiContext::new(question_bank_program, accounts),
    question_data,
)?;
```

## 🧪 Testing

Run the comprehensive test suite:

```bash
# Run all tests
anchor test

# Run specific test file
anchor test tests/question_bank.ts

# Run with local validator
anchor test --skip-deploy
```

### Test Coverage
- ✅ Program initialization
- ✅ User reputation system
- ✅ Curator management
- ✅ Question submission with validation
- ✅ Voting system with anti-fraud measures
- ✅ Question finalization workflow
- ✅ Error handling and edge cases
- ✅ Security constraints

## 🚀 Integration Patterns

### Tournament Integration
```rust
// Get questions for tournament
let approved_questions = question_bank::cpi::get_approved_questions(
    CpiContext::new(question_bank_program, accounts),
    Some("Geography".to_string()),
    Some(2),
)?;

// Use in tournament creation
create_tournament(tournament_data, approved_questions)?;
```

### Frontend Integration
```typescript
// React component example
const QuestionSubmissionForm = () => {
  const { wallet } = useWallet();
  const client = useQuestionBankClient();
  
  const handleSubmit = async (formData) => {
    if (!await client.canUserSubmitQuestions(wallet.publicKey)) {
      throw new Error("Insufficient reputation");
    }
    
    const { tx, questionId } = await client.submitQuestion(formData, wallet);
    console.log(`Question ${questionId} submitted: ${tx}`);
  };
};
```

## 📈 Reputation Economics

### Earning Reputation
- **Question Submission**: +5 points
- **Approved Question**: +50 points  
- **Voting Participation**: +10 points per vote

### Losing Reputation
- **Rejected Question**: -10 points
- **Minimum Floor**: Cannot go below 10 points

### Reputation Thresholds
- **Question Submission**: 100 points minimum
- **Curator Eligibility**: 1000+ points (manual selection)
- **Advanced Features**: Higher thresholds for premium features

## 🔮 Future Enhancements

### Planned Features
- **Category Specialization**: Track reputation by category
- **Question Difficulty Validation**: Community consensus on difficulty
- **Automated Moderation**: ML-based content filtering
- **Batch Operations**: Submit/vote on multiple questions
- **Question Updates**: Allow submitter to edit pending questions
- **Advanced Filtering**: Search by submitter, date, vote ratios

### Integration Roadmap
- **NFT Integration**: Special questions as collectible NFTs
- **DAO Governance**: Community voting on policy changes
- **Tokenomics**: SPL token rewards for quality contributions
- **Cross-Program**: Integration with tournament and reward systems

---

Built with ❤️ for the TriviaComb ecosystem