# ALL IN! — Game Specification
**Project:** Playground.exe  
**Game ID:** `all-in`  
**Genre:** Casino / Arcade / Multiplayer  
**Platform:** Browser (desktop and mobile)  
**Currency:** Fictional in-game money only

## 1. Game Overview

ALL IN! is a fast-paced casino game where players have **10 minutes to make as much money as possible** through five different casino games.

Players start with **$1,000** and can freely switch between casino tables. They can play alone or alongside friends in the same casino.

The main feature is **seamless multiplayer**: games function independently when one person is playing, but automatically become shared multiplayer experiences when another player joins that table.

There is no early cash-out. Players must reach the end of the 10-minute countdown or go bankrupt.

## 2. Core Rules

| Setting | Value |
|---|---|
| Starting bankroll | $1,000 |
| Round duration | 10 minutes |
| Players | 1–16 |
| Minimum beginner bet | $1 |
| Objective | Highest final bankroll |
| Game selection | Clickable casino floor |
| Early cash-out | Disabled |
| Bankruptcy bailout | Once per player |
| Currency | Virtual chips, no real-money gambling |

- The host starts the casino session.
- All players in a session share the same countdown.
- Every player has their own bankroll.
- Players can freely move between games without resetting money or time.
- The player with the highest adjusted bankroll at the end wins.
- Multiplayer betting outcomes must be calculated and validated by the server.
- Players may remain on the casino floor without placing bets, but cannot finish a run early.

## 3. Casino Floor and Navigation

The main interface is a stylized 2D casino floor containing five interactive game areas.

**The five games:**
1. Blackjack
2. Roulette
3. Slots
4. Plinko
5. Poker

Players click a table or machine to enter it immediately. There is **no manual walking or character movement**.

Each area displays:
- Game name and recognizable artwork
- Number of players currently there
- Player names or avatars
- Activity and animations
- A clear visual indication of whether the table is occupied

While inside a game, players can return to the casino floor using a navigation button.

The bankroll, countdown, and player ranking should remain visible across all game screens.

Switching games must not reset progress or invalidate unresolved wagers.

## 4. Casino Games

### 4.1 Blackjack

**Solo**
- Play standard blackjack against a computer dealer.
- Hit, stand, double down, and split.
- Rounds begin immediately.

**Multiplayer**
- Multiple players occupy the same blackjack table.
- Each player has an individual hand and wager.
- Everyone plays against the same dealer.
- Dealer cards and outcomes are shared.
- Player decisions have short time limits to avoid stalling.

When a second player arrives, the current solo hand finishes before the table enters synchronized multiplayer rounds.

### 4.2 Roulette

**Solo**
- Place wagers and spin immediately.
- Support red/black, odd/even, individual numbers, and standard roulette bets.

**Multiplayer**
- Players place wagers on the same roulette table.
- One shared wheel determines every player's outcome.
- Players can choose different wagers.
- Shared rounds use a short betting countdown.
- All payouts are calculated independently based on each player's wagers.

If someone joins during a solo spin, multiplayer begins at the next round.

### 4.3 Slots

**Solo**
- Spin an individual slot machine.
- Support normal wins, combinations, and rare jackpots.
- Spins should be fast with satisfying animations.

**Multiplayer**
- Every player has their own slot machine.
- Players can watch each other's wins and spins.
- Machines participate in a shared jackpot competition.
- Large wins trigger a notification visible to other players.

Slots do not need synchronized spins. Multiplayer primarily adds shared jackpot mechanics and social interaction.

### 4.4 Plinko

**Solo**
- Choose a wager and risk level.
- Drop a ball through a board of pegs.
- Receive a payout based on the multiplier where the ball lands.

**Multiplayer**
- Players use the same visible Plinko board.
- Multiple colored balls can fall simultaneously.
- Every ball has an identifiable owner.
- Each ball has its own wager and payout.
- Physics and animations should remain visually smooth.

### 4.5 Poker

**Solo**
- Play video poker.
- Receive five cards.
- Choose cards to keep.
- Draw replacements and earn payouts based on the resulting hand.

**Multiplayer**
- Open a shared player-versus-player poker table when at least two players participate.
- Players compete for a common pot.
- Use a simplified poker variant initially, preferably five-card draw.
- Server manages the deck, turns, bets, and winnings.

Poker is a special case: video poker and competitive poker have different rules. An active video-poker hand must finish before a player switches to the shared poker table.

## 5. Seamless Multiplayer System

Multiplayer is integrated into ALL IN! rather than implemented as separate game modes.

**Expected behavior:**

1. A player enters roulette alone and can spin freely.
2. A second player selects roulette from the casino floor.
3. The existing round finishes normally.
4. Both players automatically enter a synchronized shared round.
5. If one player leaves, the remaining player returns to solo gameplay after the current round.

**Requirements:**
- No separate solo/multiplayer toggle for individual casino games.
- Table transitions never reset bankrolls.
- Players joining during active rounds wait until an appropriate entry point.
- Leaving does not cancel committed wagers.
- Other players' presence, bets, and relevant results update in real time.
- Players at different tables remain part of the same casino session.
- Support up to 16 players in one party, with table-specific seating limits where necessary.

The server is authoritative over shared state, random outcomes, and payouts.

## 6. Bankruptcy and Bailout

A player becomes bankrupt when:
- Their bankroll is below the minimum available bet, and
- They have no outstanding wagers that might return money.

**First bankruptcy:**

Present a bailout screen offering:
- $100 in emergency chips
- A 60-second reduction in the player's remaining playable time
- A $200 final-score penalty
- Only one bailout per run

Players may accept or decline. Declining ends their participation and allows spectating.

**Second bankruptcy:**

The player's run ends permanently. They can spectate the rest of the match.

In multiplayer, the shared casino timer must never pause for an individual player. The time penalty instead shortens that player's personal betting eligibility. Their remaining time cannot exceed the shared match deadline.

Final leaderboard score is `max(0, final bankroll − bailout penalties)`. Show both the actual remaining bankroll and adjusted score on the results screen.

## 7. Interface and Visual Direction

**Theme: Neon Noir Casino**

The game should resemble a stylish neon arcade casino rather than a realistic gambling website.

**Color palette:**
- Midnight navy: `#090D17`
- Dark slate: `#181E32`
- Jackpot gold: `#F4C95D`
- Casino red: `#FF395B`
- Winning mint: `#23E0BE`

**Typography:**
- Bebas Neue or Anton for major headings and titles
- Inter for UI elements and body text
- Large, readable numeric displays for bankrolls, bets, and time

**Visual design:**
- 2D vector-style graphics with subtle retro/pixel texture
- Neon signs and soft glow effects
- Dark casino floor with colorful tables
- Animated slot machines and roulette wheels
- Responsive, chunky buttons
- Distinct visuals for each game
- Small player avatars around shared tables
- Smooth animations rather than realistic 3D rendering

### Animations and Sound

- Coins and numbers animate on wins.
- Major jackpots trigger dramatic visual and audio effects.
- Losing bets use short, understated red flashes.
- Clicking chips and cards produces tactile sound effects.
- All sound respects Playground.exe's mute controls.
- The last minute introduces increased visual tension, a pulsing timer, and more intense music.
- Respect reduced-motion preferences.

## 8. Heads-Up Display

The following information should be persistently accessible:

**Top-left:** Player's bankroll  
**Top-center:** ALL IN! branding / current game  
**Top-right:** Shared countdown  
**Side panel:** Live player leaderboard  
**Bottom area:** Betting controls and navigation

The casino floor and individual games must use a consistent interface.

At 60 seconds remaining, the timer changes visually to indicate the final minute.

## 9. Leaderboard and End Screen

During gameplay, display player rankings based on current bankrolls, clearly identifying any penalties.

At the 10-minute deadline:
- Prevent new bets.
- Settle any outstanding rounds according to server rules.
- Calculate adjusted final scores.
- Rank players from richest to poorest.
- Display the winner.

**Final results include:**
- Final bankroll
- Adjusted leaderboard score
- Final placement
- Highest bankroll reached
- Biggest single win
- Biggest single loss
- Total rounds played
- Number of bankruptcies
- Games played most frequently

A player cannot manually lock in their result or finish early.

## 10. Technical Architecture

Integrate with the existing Playground.exe game system.

**Game setup:**
- Scaffold with `npm run new:game all-in -- --multiplayer`.
- Keep the entire casino inside one game workspace.
- Use `@playground-exe/game-kit` for lifecycle, input, audio, and arcade integration.
- Use the existing Cloudflare Durable Object multiplayer infrastructure.
- Store authoritative multiplayer logic in `games/all-in/src/multiplayer.ts`.

**Shared server state:**
- Match start and deadline timestamps
- Individual bankrolls and penalties
- Player table locations
- Table phase and active wagers
- Blackjack hands and dealer state
- Roulette round and outcome
- Slot jackpot state
- Plinko outcomes
- Poker deck, hands, betting, and turns
- Final scores and rankings

**Important engineering rules:**
- One casino match contains all five game areas.
- Do not create a separate Playground.exe match for each casino table.
- Derive countdowns from server timestamps, not untrusted client timers.
- Validate balances, wagers, turns, and payouts server-side.
- Never accept client-reported winnings as authoritative.
- Do not broadcast hidden poker cards or unrevealed dealer information.
- Use secure server randomness for outcomes.
- Ensure switching tables does not duplicate or cancel bets.
- Avoid unnecessary continuous server updates; keep the game efficient on Cloudflare's free tier.
- Allow a standalone local solo implementation, while even one player in a party-backed match uses authoritative server state so others can seamlessly join their table.

## 11. Implementation Order

**Phase 1 — Core casino**
- Casino floor navigation
- Shared HUD and timer
- Bankroll and betting system
- Bankruptcy and bailout rules
- Game lifecycle and restart
- End-of-run results

**Phase 2 — Casino games**
- Blackjack
- Roulette
- Slots
- Plinko
- Solo video poker

All five should work independently before introducing complex shared-table behavior.

**Phase 3 — Multiplayer**
- Party integration
- Shared match timer and leaderboard
- Table membership
- Automatic solo-to-multiplayer transitions
- Shared blackjack and roulette
- Shared slot jackpots
- Shared Plinko board
- Multiplayer poker

**Phase 4 — Polish**
- Neon casino visual design
- Sounds and animations
- Player avatars and table notifications
- Jackpot announcements
- Mobile layout
- Performance optimization
- Reconnection, disconnect, and edge-case testing

## 12. Design Principles

1. **Fast:** Switching games should be nearly instant.
2. **Social:** Other players' actions should make the casino feel alive.
3. **Seamless:** Multiplayer should happen naturally without interrupting rounds.
4. **Fair:** The server controls outcomes and bankrolls.
5. **Readable:** Despite flashy effects, betting and financial information must remain clear.
6. **Accessible:** Works on desktop and mobile.
7. **Replayable:** Different wagers, game choices, and player interactions create different runs.
8. **Time-limited:** Every match lasts exactly 10 minutes of shared game time, with no early cash-out.

**Core vision:** ALL IN! should feel like a lively multiplayer neon casino where players are free to explore five gambling minigames, take calculated risks, and compete to become the richest player before the clock runs out.
