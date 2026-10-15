/**
 * `/forms/:id/results`, `/forms/:id/responses` and `/forms/:id/export.csv`.
 */
import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  responsesQuerySchema,
  resultsQuerySchema,
  type Results,
  type ResultsQuery,
  type ResponsesPage,
  type SessionUser,
} from '@forms/shared';
import type { Response } from 'express';
import type { z } from 'zod';

import { CurrentUser } from '../common/session.guard';
import { ZodPipe } from '../common/zod.pipe';
import { formIdPipe } from '../forms/forms.controller';
import { ResultsService } from './results.service';

const exportQuerySchema = responsesQuerySchema.pick({ version: true });

@Controller('forms/:id')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get('results')
  report(
    @CurrentUser() user: SessionUser,
    @Param('id', formIdPipe) id: string,
    @Query(new ZodPipe(resultsQuerySchema)) query: ResultsQuery,
  ): Promise<Results> {
    return this.results.results(user.id, id, query);
  }

  @Get('responses')
  responses(
    @CurrentUser() user: SessionUser,
    @Param('id', formIdPipe) id: string,
    @Query(new ZodPipe(responsesQuerySchema)) query: z.infer<typeof responsesQuerySchema>,
  ): Promise<ResponsesPage> {
    return this.results.responses(user.id, id, query.version, query.cursor);
  }

  /**
   * Streamed: each page of 500 rows is written as it is read, so memory stays
   * flat whatever the response count. Errors before the first byte become a
   * normal error response through the filter; an error mid-stream can only
   * abort the connection, which the client sees as a truncated download rather
   * than as a file that looks complete.
   */
  @Get('export.csv')
  async export(
    @CurrentUser() user: SessionUser,
    @Param('id', formIdPipe) id: string,
    @Query(new ZodPipe(exportQuerySchema)) query: z.infer<typeof exportQuerySchema>,
    @Res() response: Response,
  ): Promise<void> {
    const { filename, chunks } = await this.results.export(user.id, id, query.version);
    response.status(200);
    response.setHeader('content-type', 'text/csv; charset=utf-8');
    response.setHeader('content-disposition', `attachment; filename="${filename}"`);
    response.setHeader('cache-control', 'no-store');
    try {
      for await (const chunk of chunks) {
        if (!response.write(chunk)) await new Promise((resolve) => response.once('drain', resolve));
      }
      response.end();
    } catch (error) {
      console.error('[api] export failed mid-stream', error);
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
