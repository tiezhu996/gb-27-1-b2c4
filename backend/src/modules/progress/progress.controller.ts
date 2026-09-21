import { Controller, Get, Post, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ProgressService } from './progress.service';
import { ReportProgressDto } from './dto/report-progress.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('courses')
@UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Post(':courseId/lessons/:lessonId/progress')
  reportProgress(
    @Request() req,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Body() dto: ReportProgressDto,
  ) {
    return this.progressService.reportProgress(req.user, courseId, lessonId, dto);
  }

  @Get(':courseId/progress')
  getCourseProgress(@Request() req, @Param('courseId') courseId: string) {
    return this.progressService.getCourseProgress(req.user, courseId);
  }
}
