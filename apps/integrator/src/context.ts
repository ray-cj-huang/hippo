import type { Db } from "@hippo/db";
import { ClinicTime } from "./clinic-time";
import type { Config } from "./config";
import { SlotTokens } from "./slot-token";

export type Ctx = {
  db: Db;
  config: Config;
  time: ClinicTime;
  tokens: SlotTokens;
  now: () => Date;
};

export function createContext(db: Db, config: Config, now: () => Date = () => new Date()): Ctx {
  return {
    db,
    config,
    time: new ClinicTime(config.timezone),
    tokens: new SlotTokens(config.slotTokenSecret, config.slotTokenTtlSeconds),
    now,
  };
}
