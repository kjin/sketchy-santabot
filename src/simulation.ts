import seedrandom from "seedrandom";
import { SantaBot } from "./common/santa";
import { scoring } from "./common/scoring";

const PARTICIPANT_COUNT = Number(process.argv[2]) || 10;
const YEARS = Number(process.argv[3]) || 10;
const ITERATIONS = Number(process.argv[4]) || 10000;
const SEED = Number(process.argv[5]) || 0;

const names = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  .split("")
  .slice(0, PARTICIPANT_COUNT);
const bot = new SantaBot();
const random = seedrandom(SEED.toString(16));
const penalties = [];
for (let i = 0; i < YEARS; i++) {
  const arrangement = bot.generateBestArrangement(
    random.int32(),
    ITERATIONS,
    scoring,
    names.filter((_) => random() < 0.99)
  );
  const penalty = bot.scoreArrangement(arrangement, scoring);
  console.log(`=== Year ${i + 1} ===`);
  console.log(bot.stagedArrangementToString(arrangement, scoring));
  bot.applyArrangement(arrangement);
  penalties.push(penalty);
}
const totalPenalty = penalties.reduce((a, b) => a + b, 0);
console.log(`=== ${YEARS}-year Summary ===`);
console.log(`Total Penalty: ${totalPenalty} (${penalties.join(", ")})`);
