import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ComplianceModule } from "../compliance/compliance.module";
import { InvitationsController } from "./invitations.controller";
import { InvitationsService } from "./invitations.service";
import { TeamController } from "./team.controller";
import { TeamService } from "./team.service";

@Module({
  imports: [AuthModule, ComplianceModule],
  controllers: [InvitationsController, TeamController],
  providers: [InvitationsService, TeamService],
})
export class InvitationsModule {}
