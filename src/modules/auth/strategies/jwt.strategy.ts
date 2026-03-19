import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthKeyConfig, AuthKeyConfigName } from "src/common/config/authkey.config";
import { JwtPayload } from "../interfaces/jwt-payload.interface";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
    constructor(private readonly config: ConfigService) {
    const { publicKey } = config.getOrThrow<AuthKeyConfig>(AuthKeyConfigName);
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: publicKey,
            algorithms: ['RS256'],
        });
    }
    async validate(payload: JwtPayload): Promise<JwtPayload> {
        if (!payload.sub || !payload.tenantId) {
        throw new UnauthorizedException('Invalid token payload');
        }
        return payload;
    }
}