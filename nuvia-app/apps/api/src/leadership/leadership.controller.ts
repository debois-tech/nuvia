import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthedRequest, Roles } from '../auth/roles';
import { readRawBody } from '../common/body';
import { parse } from '../common/zod';
import { APP_CONFIG, AppConfig } from '../config/config';
import { ActivityService } from './activity.service';
import { AlertsService } from './alerts.service';
import { FinanceService } from './finance.service';
import { GoalsService } from './goals.service';
import { HealthRulesSchema } from './health';
import { HealthService } from './health.service';
import { CreateGoalBody, CreateMilestoneBody, FinanceQuery, ImportQuery, LinkBody, OverviewQuery, UpdateGoalBody, UpdateMilestoneBody } from './schemas';

/**
 * Everything under /leadership is for executives (CEO, CTO, COO) only. The role is checked here on the server;
 * other roles get 403 whatever the UI shows.
 */
@Controller('leadership')
@Roles('executive')
export class LeadershipController {
  constructor(
    private readonly finance: FinanceService,
    private readonly health: HealthService,
    private readonly goals: GoalsService,
    private readonly alerts: AlertsService,
    private readonly activity: ActivityService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /**
   * The leadership home page in one call: the verdict, what is off track, a goals summary, and the work done in the
   * chosen months (default: this fiscal year so far) next to an optional comparison range.
   */
  @Get('overview')
  async overview(@Query() query: unknown) {
    const q = parse(OverviewQuery, query);
    const alerts = await this.alerts.sync();
    const range = await this.finance.resolveRange(q);
    const compareRange = this.finance.compareRange(range, q);
    const [health, goals, imports, now, before] = await Promise.all([
      this.health.evaluate(),
      this.goals.list(),
      this.finance.imports(),
      this.activity.forRange(range),
      compareRange ? this.activity.forRange(compareRange) : null,
    ]);
    return { health, alerts, goals: goals.summary, latestImport: imports[0] ?? null, activity: { range, compareRange, ...now, compare: before } };
  }

  @Get('alerts')
  listAlerts() {
    return this.alerts.sync();
  }

  // ---- Sheets and revenue ----

  /** The file is the raw request body (application/octet-stream); its name, sheet and mapping travel in the query string. */
  @Post('imports/preview')
  async preview(@Req() req: Request, @Query() query: unknown) {
    return this.finance.preview(await readRawBody(req, this.cfg.maxImportBytes), parse(ImportQuery, query));
  }

  @Post('imports')
  async importSheet(@Req() req: AuthedRequest, @Query() query: unknown) {
    return this.finance.import(req.user, await readRawBody(req, this.cfg.maxImportBytes), parse(ImportQuery, query));
  }

  @Get('imports')
  imports() {
    return this.finance.imports();
  }

  @Get('finance')
  dashboard(@Query() query: unknown) {
    return this.finance.dashboard(parse(FinanceQuery, query));
  }

  // ---- Company health ----

  @Get('health')
  getHealth() {
    return this.health.evaluate();
  }

  @Put('health/rules')
  async saveRules(@Req() req: AuthedRequest, @Body() body: unknown) {
    const saved = await this.health.saveRules(req.user, parse(HealthRulesSchema, body));
    await this.alerts.sync();
    return saved;
  }

  // ---- Goals, milestones and links ----

  @Get('people')
  people() {
    return this.goals.people();
  }

  @Get('goals')
  listGoals() {
    return this.goals.list();
  }

  @Post('goals')
  createGoal(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.goals.create(req.user, parse(CreateGoalBody, body));
  }

  // Declared before 'goals/:id' routes that share a prefix.
  @Patch('milestones/:id')
  updateMilestone(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.goals.updateMilestone(req.user, id, parse(UpdateMilestoneBody, body));
  }

  @Delete('milestones/:id')
  deleteMilestone(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.goals.deleteMilestone(req.user, id);
  }

  @Get('goals/:id')
  getGoal(@Param('id', ParseUUIDPipe) id: string) {
    return this.goals.get(id);
  }

  @Patch('goals/:id')
  updateGoal(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.goals.update(req.user, id, parse(UpdateGoalBody, body));
  }

  @Post('goals/:id/milestones')
  createMilestone(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.goals.createMilestone(req.user, id, parse(CreateMilestoneBody, body));
  }

  @Post('goals/:id/links')
  addLink(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.goals.addLink(req.user, id, parse(LinkBody, body));
  }

  @Delete('goals/:id/links/:linkId')
  removeLink(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Param('linkId', ParseUUIDPipe) linkId: string) {
    return this.goals.removeLink(req.user, id, linkId);
  }
}
