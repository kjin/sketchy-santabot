import { Action, Scoring } from "./santa";

export const scoring: Scoring = {
  actions: (action: Action, yearsAgo: number): number => {
    if (action === Action.GaveTo) {
      return Math.max(10 - yearsAgo + 1, 0);
    } else if (action === Action.ReceivedFrom) {
      if (yearsAgo === 1) return 5;
      else if (yearsAgo < 10) return 1; // lol
      return 0;
    }
    return 0;
  },
  rings: (ringSizes: number[]): number => {
    if (ringSizes.indexOf(1) !== -1) return 1000;
    if (ringSizes.length > 1) {
      if (ringSizes.indexOf(2) !== -1) return 10;
      return 5;
    }
    return 0;
  },
};
