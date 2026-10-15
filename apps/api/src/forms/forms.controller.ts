/**
 * `/forms`: the author's side. Every route needs the service token (the global
 * guard is default-closed) and every query is scoped to the token's user.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  createFormSchema,
  idSchema,
  saveDraftSchema,
  updateFormSchema,
  type CreateFormInput,
  type FormDetail,
  type FormSummary,
  type PublishResult,
  type SaveDraftInput,
  type SessionUser,
} from '@forms/shared';
import type { z } from 'zod';

import { CurrentUser } from '../common/session.guard';
import { ZodPipe } from '../common/zod.pipe';
import { FormsService } from './forms.service';

/** Shared by every `:id` route, so a malformed id is a 400 before any query runs. */
export const formIdPipe = new ZodPipe(idSchema);

@Controller('forms')
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser): Promise<FormSummary[]> {
    return this.forms.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodPipe(createFormSchema)) input: CreateFormInput,
  ): Promise<{ id: string; slug: string }> {
    return this.forms.create(user.id, input.title);
  }

  @Get(':id')
  detail(
    @CurrentUser() user: SessionUser,
    @Param('id', formIdPipe) id: string,
  ): Promise<FormDetail> {
    return this.forms.detail(user.id, id);
  }

  @Put(':id/draft')
  saveDraft(
    @CurrentUser() user: SessionUser,
    @Param('id', formIdPipe) id: string,
    @Body(new ZodPipe(saveDraftSchema)) input: SaveDraftInput,
  ): Promise<{ revision: number }> {
    return this.forms.saveDraft(user.id, id, input);
  }

  /** 200 rather than 201: publishing an unchanged draft creates nothing. */
  @HttpCode(HttpStatus.OK)
  @Post(':id/publish')
  publish(
    @CurrentUser() user: SessionUser,
    @Param('id', formIdPipe) id: string,
  ): Promise<PublishResult> {
    return this.forms.publish(user.id, id);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Patch(':id')
  async update(
    @CurrentUser() user: SessionUser,
    @Param('id', formIdPipe) id: string,
    @Body(new ZodPipe(updateFormSchema)) input: z.infer<typeof updateFormSchema>,
  ): Promise<void> {
    await this.forms.setAccepting(user.id, id, input.accepting);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(
    @CurrentUser() user: SessionUser,
    @Param('id', formIdPipe) id: string,
  ): Promise<void> {
    await this.forms.remove(user.id, id);
  }
}
