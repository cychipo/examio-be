import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
    Strategy,
    Profile,
    StrategyOptions,
    StrategyOptionsWithRequest,
} from 'passport-github2';
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
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
    constructor(private authService: AuthService) {
        super({
            clientID: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            callbackURL: process.env.GITHUB_CALLBACK_URL,
            scope: ['user:email'],
            passReqToCallback: true,
        } as unknown as StrategyOptionsWithRequest);
    }

    async validate(
        req: Request,
        accessToken: string,
        refreshToken: string,
        profile: Profile,
        done: Function
    ) {
        const { username, emails, photos, id } = profile;

        const user = {
            email: emails?.[0]?.value,
            username: username || emails?.[0]?.value,
            avatar: photos?.[0]?.value,
            githubId: id,
            accessToken,
        };

        const roleFromCookie = req.cookies?.oauth_role;
        const role =
            roleFromCookie === 'teacher' || roleFromCookie === 'student'
                ? roleFromCookie
                : getRoleFromState(req.query?.state as string | undefined);
        console.log('[OAuth][GitHub] Role resolution', {
            email: user.email,
            roleFromCookie,
            state: req.query?.state,
            resolvedRole: role,
        });
        const result = await this.authService.githubLogin(user, undefined, role);
        done(null, result);
    }
}
