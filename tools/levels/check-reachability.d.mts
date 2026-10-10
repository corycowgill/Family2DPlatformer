export interface ReachResult {
  problems: string[];
  info: string[];
  reached?: number;
  stats?: { coins: number; width: number; height: number };
}
export function checkLevel(id: string, text: string, opts?: { verbose?: boolean; map?: boolean }): ReachResult;
