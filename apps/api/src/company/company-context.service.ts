import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolves the deployment's single company on the server (spec REQ-NFR-008).
 * Never read the company from client input.
 */
@Injectable()
export class CompanyContextService {
  private companyId?: string;

  constructor(private readonly prisma: PrismaService) {}

  async getCompanyId(): Promise<string> {
    if (this.companyId) {
      return this.companyId;
    }

    const companies = await this.prisma.company.findMany({ select: { id: true }, take: 2 });
    if (companies.length !== 1) {
      throw new InternalServerErrorException(
        `Expected exactly one company record, found ${companies.length}. Run the seed.`,
      );
    }

    this.companyId = companies[0].id;
    return this.companyId;
  }
}
