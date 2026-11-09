# Jarvis Performance Score

A 0 to 100 summary of how a set of closed trades went, drawn as a six-axis radar on the dashboard. It describes the trades in the current filters. It predicts nothing and is not advice.

The code is `computeScore` in `src/lib/domain/metrics.ts`, and its tests are in `src/lib/domain/metrics.test.ts` ("the Jarvis Performance Score, by hand"). The anchors and weights below are Jarvis's own judgement calls, not an industry standard, and not any other product's formula.

## Inputs

All inputs come from `computeMetrics` over the closed trades that pass the dashboard's filters, in one account currency. The score is always computed in money, whatever unit the dashboard is displaying, and never mixes currencies.

| Input | Definition |
|---|---|
| Win rate | winning trades ÷ closed trades. Breakeven trades count in the denominator. |
| Profit factor | gross profit ÷ \|gross loss\| |
| Avg win/loss | average winning trade ÷ \|average losing trade\| |
| Recovery factor | net P&L ÷ deepest drawdown of the closed-trade equity curve |
| Drawdown depth | deepest drawdown ÷ \|average losing trade\|: how many typical losses deep the worst fall went |
| Best-day share | best day's P&L ÷ the sum of all winning days' P&L. Days are calendar days of the close time, in the zone set in Settings. |

## Scaling

Each input is mapped to 0 to 100 by straight lines between anchor points. It is flat beyond the first and last anchor (`ramp`).

| Axis | Weight | Anchors (input = score) | Special cases |
|---|---|---|---|
| Win % | 15 | 20% = 0, 40% = 50, 60% = 100 | none |
| Profit factor | 20 | 0.5 = 0, 1 = 40, 1.5 = 70, 2.5 = 100 | No losses (and at least one win): 100 |
| Avg win/loss | 15 | 0.5 = 0, 1 = 40, 2 = 75, 3 = 100 | No losses: 100. No wins: blank. |
| Recovery factor | 20 | −1 = 0, 0 = 30, 1 = 50, 3 = 80, 6 = 100 | No drawdown and a profit: 100. No drawdown and no profit: blank. |
| Max drawdown | 15 | 1 = 100, 3 = 80, 6 = 50, 10 = 20, 15 = 0 (losses deep) | No drawdown: 100. A drawdown with no losing trade can't be sized: blank. |
| Consistency | 15 | 15% = 100, 30% = 75, 50% = 40, 100% = 0 (best-day share) | No winning day: 0 |

Why these anchors:

- **Win %** alone says little: the other axes carry payoff. So 40% scores 50, and the scale tops out at 60%.
- **Profit factor**: break-even (1.0) sits below the middle, at 40. Values past 2.5 are rare over a meaningful sample, so they don't add more.
- **Avg win/loss**: 1:1 is the break-even point for a 50% win rate. A 2:1 payoff is the usual target, at 75.
- **Recovery factor**: 0 means the period ended where it started, scored 30. A drawdown recovered three times over scores 80.
- **Max drawdown** is counted in typical losses rather than money or percent, because Jarvis does not always know the account balance. A fall of three average losses is ordinary, scored 80. Ten is severe, scored 20.
- **Consistency** asks whether profit rests on one day. If the best day is 15% or less of all winning-day profit, the score is 100. If one day is all of it, the score is 0.

## The total

Score = Σ(axis score × weight) ÷ Σ(weights of axes that have a value). It is rounded to 2 decimals.

A blank axis sits out, and the others are reweighted. The radar draws a blank axis as a dashed spoke, never as zero.

## Minimums

No total is shown until there are **at least 20 closed trades across at least 5 trading days** (`SCORE_MIN_TRADES`, `SCORE_MIN_DAYS`). Below that, the axes still show their own values, and the card says how many trades and days are still needed. Trades left out of the figures (a missing conversion rate, or fills that don't add up) don't count.

## Worked example

These are the inputs used in the unit test:

| Axis | Input | Score |
|---|---|---|
| Win % | 50% | 75 |
| Profit factor | 2.2 | 91 |
| Avg win/loss | 1.5 | 57.5 |
| Recovery factor | 1.8 | 62 |
| Max drawdown | 300 ÷ 75 = 4 losses deep | 70 |
| Consistency | 200 ÷ 500 = 40% | 57.5 |

Total = (15×75 + 20×91 + 15×57.5 + 20×62 + 15×70 + 15×57.5) ÷ 100 = **69.6**.

## Colour bar

The dashboard shows the total on a red → amber → green bar with ticks at 0, 20, 40, 60, 80 and 100. The colour is decoration: the number is the score.

## What changed on 2026-11-09

The earlier score had different axes: profitability, edge per trade, drawdown control, consistency of winning days, plan discipline and stop use. It was rounded to a whole number. Scores from before this date are not comparable with the new one.
