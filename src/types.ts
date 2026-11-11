import type { AnnotationScope, KanaScript } from './settings';

export type AnnotationColumn = {
  kana: string;
  romaji: string;
};

export type Piece =
  | { kind: 'text'; text: string }
  | { kind: 'ruby'; base: string; romaji: string; kana?: string; columns?: AnnotationColumn[] };

export type AnnotateRequest = {
  type: 'annotate';
  id: number;
  script: KanaScript;
  scope: AnnotationScope;
  texts: string[];
};

export type AnnotateResponse = {
  type: 'annotate';
  id: number;
  pieces: Piece[][];
  error?: string;
};

export type StatusResponse = {
  ready: boolean;
  loading: boolean;
  error: string | null;
};
