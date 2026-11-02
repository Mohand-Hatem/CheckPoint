import { Global, Module } from '@nestjs/common';
import { CompanyPolicyService } from './company-policy.service';

@Global()
@Module({
  providers: [CompanyPolicyService],
  exports: [CompanyPolicyService],
})
export class CompanyModule {}
