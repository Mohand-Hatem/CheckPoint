import { Global, Module } from '@nestjs/common';
import { CompanyContextService } from './company-context.service';

@Global()
@Module({
  providers: [CompanyContextService],
  exports: [CompanyContextService],
})
export class CompanyModule {}
