/**
 * What must be true before `NestFactory.create` is called.
 *
 * **Every reason this process will not work is discovered before it is
 * listening.** An API that binds :4000 and then fails on the first save looks
 * healthy to a container runtime, gets traffic, and produces a user-facing error
 * for an operational fact that was already true when the process started.
 *
 * Called from `main.ts` before the Nest application exists, so a failure here is
 * a plain sentence on stderr rather than a framework stack with the one useful
 * line buried in the middle of it.
 */
import type { ApiConfig } from './config';

export class BootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootError';
  }
}

/**
 * The JSON body ceiling `main.ts` gives express. A draft of 100 questions with
 * 20 options each and logic on all of them is about 300 KB; one megabyte is
 * that with room, and still a ceiling.
 */
export const JSON_BODY_LIMIT_BYTES = 1_048_576;

export function assertConsistent(config: ApiConfig): void {
  // Auth is the credential-stuffing surface, so its budget is deliberately far
  // below the general one. A configuration where auth is the looser of the two
  // is almost certainly a copy-paste, and it is the exact mistake that turns a
  // rate limit into decoration.
  if (config.rateLimitAuth >= config.rateLimitGlobal) {
    throw new BootError(
      `RATE_LIMIT_AUTH (${String(config.rateLimitAuth)}) must be below RATE_LIMIT_GLOBAL ` +
        `(${String(config.rateLimitGlobal)}). Auth is the credential-stuffing surface; a budget ` +
        'at or above the general one is not a limit.',
    );
  }

  // A respondent saves once per question. A budget below a form's length means
  // an honest respondent is refused half-way through, which looks like the form
  // being broken rather than like a limit.
  if (config.rateLimitRespond < 30) {
    throw new BootError(
      `RATE_LIMIT_RESPOND (${String(config.rateLimitRespond)}) is below 30. Every answered ` +
        'question is one save, so an honest respondent to a long form would be refused part-way.',
    );
  }

  // The answers ceiling is enforced by the service after parsing; a ceiling
  // above the body parser's would be dead configuration, because express would
  // refuse the request first with a less useful error.
  if (config.maxAnswersBytes >= JSON_BODY_LIMIT_BYTES) {
    throw new BootError(
      `MAX_ANSWERS_BYTES (${String(config.maxAnswersBytes)}) must be below the JSON body limit ` +
        `(${String(JSON_BODY_LIMIT_BYTES)}), or the body parser refuses the request first.`,
    );
  }

  if (config.responsesPageSize > 500) {
    throw new BootError(
      `RESPONSES_PAGE_SIZE (${String(config.responsesPageSize)}) is above 500. The response ` +
        'table renders every row of a page; a page this large is a table nobody can read.',
    );
  }
}

export function assertBootable(config: ApiConfig): void {
  assertConsistent(config);
}
