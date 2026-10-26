import { Global, Module } from '@nestjs/common';
import { CompanyContextService } from './company-context.service';
import { CompanyPolicyService } from './company-policy.service';

@Global()
@Module({
  providers: [CompanyContextService, CompanyPolicyService],
  exports: [CompanyContextService, CompanyPolicyService],
})
export class CompanyModule {}
