import { IsNumber, Min, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class ReportProgressDto {
  /** 当前播放位置（秒） */
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  position: number;

  /** 课时媒体总时长（秒） */
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  duration: number;

  /** 前端是否判定已完成（播放到 95%），最终以后端校验为准 */
  @IsOptional()
  completed?: boolean;
}
