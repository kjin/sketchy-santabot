import seedrandom from "seedrandom";

export type Arrangement = Array<[string, string]>;

export enum Action {
  GaveTo,
  ReceivedFrom,
}

export interface Scoring {
  actions: (action: Action, yearsAgo: number) => number;
  rings: (ringSizes: number[]) => number;
}

export class SantaBot {
  protected readonly participants = new Map<string, Array<string | null>>();
  private numYearsCache = -1;

  constructor() {}

  private getNumYears() {
    if (this.numYearsCache === -1) {
      this.numYearsCache = [...this.participants.values()].reduce(
        (prev, arr) => Math.max(prev, arr.length),
        0
      );
    }
    return this.numYearsCache;
  }

  generateArrangement(seed: number, participants?: string[]): Arrangement {
    participants = participants ?? [...this.participants.keys()];
    const random = seedrandom(seed.toString(16));
    const preSortedResult: Arrangement = [];
    const remainingReceivers = [...participants];
    for (const giver of participants ?? this.participants.keys()) {
      let index: number;
      if (remainingReceivers.length === 1) {
        index = 0;
      } else {
        do {
          index = Math.floor(random() * remainingReceivers.length);
        } while (remainingReceivers[index] === giver);
      }
      preSortedResult.push([giver, remainingReceivers[index]]);
      remainingReceivers.splice(index, 1);
    }
    const result: Arrangement = [];
    const seenGivers = new Set();
    for (const giver of participants) {
      let currentGiver = giver;
      while (!seenGivers.has(currentGiver)) {
        seenGivers.add(currentGiver);
        const foundPair = preSortedResult.find(([x]) => x === currentGiver);
        result.push(foundPair);
        currentGiver = foundPair[1];
      }
    }
    return result;
  }

  getNumOptimalArrangements(
    seed: number,
    iterations: number,
    scoring: Scoring,
    participants?: string[]
  ): number {
    const random = seedrandom(seed.toString(16));
    let optimalArrangements = 0;
    for (let j = 0; j < iterations; j++) {
      const stagedArrangement = this.generateArrangement(
        random.int32(),
        participants
      );
      const stagedPenalty = this.scoreArrangement(stagedArrangement, scoring);
      if (stagedPenalty === 0) {
        optimalArrangements++;
      }
    }
    return optimalArrangements;
  }

  generateBestArrangement(
    seed: number,
    iterations: number,
    scoring: Scoring,
    participants?: string[]
  ): Arrangement {
    const random = seedrandom(seed.toString(16));
    let bestArrangement = null;
    let bestPenalty = Infinity;
    for (let j = 0; j < iterations; j++) {
      const stagedArrangement = this.generateArrangement(
        random.int32(),
        participants
      );
      const stagedPenalty = this.scoreArrangement(stagedArrangement, scoring);
      if (stagedPenalty < bestPenalty) {
        bestArrangement = stagedArrangement;
        bestPenalty = stagedPenalty;
      }
      if (bestPenalty === 0) break;
    }
    return bestArrangement;
  }

  scoreArrangement(arrangement: Arrangement, scoreFns: Scoring): number {
    const rings: string[][] = [];
    let totalPenalty = 0;
    for (const [giver, receiver] of arrangement) {
      const ring = rings.find((ring) => ring[ring.length - 1] === giver);
      if (ring) {
        ring.push(receiver);
      } else {
        rings.push([giver, receiver]);
      }
      {
        const foundIndex =
          this.participants.get(giver)?.indexOf(receiver) ?? -1;
        totalPenalty +=
          foundIndex !== -1
            ? scoreFns.actions(Action.GaveTo, this.getNumYears() - foundIndex)
            : 0;
      }
      {
        const foundIndex =
          this.participants.get(receiver)?.indexOf(giver) ?? -1;
        totalPenalty +=
          foundIndex !== -1
            ? scoreFns.actions(
                Action.ReceivedFrom,
                this.getNumYears() - foundIndex
              )
            : 0;
      }
    }
    totalPenalty += scoreFns.rings(rings.map((x) => x.length - 1));
    return totalPenalty;
  }

  stagedArrangementToString(
    arrangement: Arrangement,
    scoreFns?: Scoring
  ): string {
    const rings: string[][] = [];
    let str = "";
    let totalPenalty = 0;
    for (const [giver, receiver] of arrangement) {
      str += `${giver} gives to ${receiver}`;
      const ring = rings.find((ring) => ring[ring.length - 1] === giver);
      if (ring) {
        ring.push(receiver);
      } else {
        rings.push([giver, receiver]);
      }
      const penaltyStrings = [];
      if (scoreFns) {
        {
          const foundIndex =
            this.participants.get(giver)?.indexOf(receiver) ?? -1;
          const yearsAgo = this.getNumYears() - foundIndex;
          const penalty =
            foundIndex !== -1 ? scoreFns.actions(Action.GaveTo, yearsAgo) : 0;
          if (penalty) {
            totalPenalty += penalty;
            penaltyStrings.push(
              `${penalty}-point penalty from repetition ${yearsAgo} years ago`
            );
          }
        }
        {
          const foundIndex =
            this.participants.get(receiver)?.indexOf(giver) ?? -1;
          const yearsAgo = this.getNumYears() - foundIndex;
          const penalty =
            foundIndex !== -1
              ? scoreFns.actions(Action.ReceivedFrom, yearsAgo)
              : 0;
          if (penalty) {
            totalPenalty += penalty;
            penaltyStrings.push(
              `${penalty}-point penalty from reverse-repetition ${yearsAgo} years ago`
            );
          }
        }
      }
      if (penaltyStrings.length > 0) {
        str += ` (${penaltyStrings.join(", ")})`;
      }
      str += "\n";
    }
    const ringSizes = rings.map((x) => x.length - 1);
    str += `Ring Sizes: ${ringSizes.join(", ")}`;
    if (scoreFns) {
      const penalty = scoreFns.rings(ringSizes);
      if (penalty) {
        totalPenalty += penalty;
        str += ` (${penalty}-point penalty)`;
      }
      str += `\nTotal Penalty: ${totalPenalty}`;
    }
    return str;
  }

  applyArrangement(arrangement: Arrangement) {
    for (const [giver, receiver] of arrangement) {
      if (!this.participants.has(giver)) {
        this.participants.set(giver, [
          ...new Array(this.getNumYears()).fill(null),
          receiver,
        ]);
      } else {
        const arr = this.participants.get(giver)!;
        while (arr.length < this.getNumYears()) {
          arr.push(null);
        }
        arr.push(receiver);
      }
    }
    this.numYearsCache = -1;
  }
}
