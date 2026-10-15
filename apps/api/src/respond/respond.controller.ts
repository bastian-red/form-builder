/**
 * `/public`: the only routes a respondent reaches, through the web app's server
 * actions. No token: a respondent has no account. Both carry the `respond`
 * budget, keyed by the respondent's address.
 */
import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  responseIdSchema,
  saveResponseSchema,
  slugSchema,
  type PublicForm,
  type SaveResponseInput,
  type SaveResponseResult,
} from '@forms/shared';

import { Public } from '../common/session.guard';
import { Budget } from '../common/throttle';
import { ZodPipe } from '../common/zod.pipe';
import { RespondService } from './respond.service';

@Controller('public')
export class RespondController {
  constructor(private readonly respond: RespondService) {}

  @Public()
  @Budget('respond')
  @Get('forms/:slug')
  form(@Param('slug', new ZodPipe(slugSchema)) slug: string): Promise<PublicForm> {
    return this.respond.publicForm(slug);
  }

  /** PUT, because the client names the resource: the same request twice is one row. */
  @Public()
  @Budget('respond')
  @Put('responses/:id')
  save(
    @Param('id', new ZodPipe(responseIdSchema)) id: string,
    @Body(new ZodPipe(saveResponseSchema)) input: SaveResponseInput,
  ): Promise<SaveResponseResult> {
    return this.respond.save(id, input);
  }
}
