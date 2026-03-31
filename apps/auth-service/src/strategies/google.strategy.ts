import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
    Strategy,
    VerifyCallback,
    StrategyOptions,
    StrategyOptionsWithRequest,
} from 'passport-google-oauth20';
import { Request } from 'express';
import { AuthService } from '../auth.service';

function getRoleFromState(state?: string): 'teacher' | 'student' {
    if (!state) {
        return 'student';
    }

    try {
        const parsed = JSON.parse(
            Buffer.from(state, 'base64url').toString('utf8')
        );
        return parsed?.role === 'teacher' ? 'teacher' : 'student';
    } catch {
        return 'student';
    }
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
    constructor(private authService: AuthService) {
        super({
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL,
            scope: ['email', 'profile'],
            passReqToCallback: true,
        } as unknown as StrategyOptionsWithRequest);
    }

    async validate(
        req: Request,
        accessToken: string,
        refreshToken: string,
        profile: any,
        done: VerifyCallback
    ): Promise<any> {
        const { name, emails, photos } = profile;
        const user = {
            email: emails[0].value,
            firstName: name.givenName,
            lastName: name.familyName,
            picture: photos[0].value,
            accessToken,
        };

        const roleFromCookie = req.cookies?.oauth_role;
        const role =
            roleFromCookie === 'teacher' || roleFromCookie === 'student'
                ? roleFromCookie
                : getRoleFromState(req.query?.state as string | undefined);
        console.log('[OAuth][Google] Role resolution', {
            email: user.email,
            roleFromCookie,
            state: req.query?.state,
            resolvedRole: role,
        });
        const result = await this.authService.googleLogin(user, undefined, role);
        done(null, result);
    }
}
