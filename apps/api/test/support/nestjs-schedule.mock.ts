import { DynamicModule } from "@nestjs/common";

export class ScheduleModule {
  static forRoot(): DynamicModule {
    return { module: ScheduleModule };
  }
}

export function Cron(_expression: string, _options?: unknown): MethodDecorator {
  return () => undefined;
}
