import { Injectable } from '@nestjs/common';
import { JwtPayload } from '..';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt, StrategyOptions } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { resolveJwtAccessSecret } from '../configs/jwt-sign.config';

@Injectable()
export class JwtUserStrategy extends PassportStrategy(Strategy, 'jwt-user') {
  constructor(configService: ConfigService) {
    const secret: string = resolveJwtAccessSecret(configService);
    const opts: StrategyOptions = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    };

    super(opts);
  }

  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
