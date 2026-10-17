export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  RENDER_QUEUE: Queue<RenderJob>;
  ASSETS: Fetcher;
  COMFY_URL: string;
  COMFY_CHECKPOINT: string;
  COMFY_CONTROLNET: string;
  CONTROLNET_STRENGTH: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
  DEV_LOGIN?: string; // "true" only in .dev.vars
}

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
  locale: string;
}

export interface RenderJob {
  renderId: string;
}

export interface RenderRow {
  id: string;
  user_id: string;
  status: "queued" | "running" | "done" | "failed";
  brief: string;
  sketch_key: string;
  mask_key: string | null;
  result_key: string | null;
  width: number;
  height: number;
  seed: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: User } };
