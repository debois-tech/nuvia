import { Module } from '@nestjs/common';
import { TaskAccess } from './access.service';
import { AttachmentsService } from './attachments.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { RemindersService } from './reminders.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  controllers: [ProjectsController, TasksController],
  providers: [TaskAccess, ProjectsService, TasksService, AttachmentsService, RemindersService],
  exports: [RemindersService],
})
export class TasksModule {}
