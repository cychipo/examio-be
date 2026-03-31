import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
    Strategy,
    StrategyOptionsWithRequest,
    Profile,
} from 'passport-facebook';
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
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
    constructor(private authService: AuthService) {
        super({
            clientID: process.env.FACEBOOK_CLIENT_ID,
            clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
            callbackURL: process.env.FACEBOOK_CALLBACK_URL,
            profileFields: ['id', 'emails', 'name', 'picture.type(large)'],
            scope: ['email'],
        } as StrategyOptionsWithRequest);
    }

    async validate(
        req: Request,
        accessToken: string,
        refreshToken: string,
        profile: Profile,
        done: (error: any, user?: any) => void
    ): Promise<any> {
        const { emails, name, photos, id, username } = profile;

        const user = {
            email: emails?.[0]?.value,
            firstName: name?.givenName,
            username: username || emails?.[0]?.value.split('@')[0],
            lastName: name?.familyName,
            picture: photos?.[0]?.value,
            accessToken,
            facebookId: id,
        };

        const roleFromCookie = req.cookies?.oauth_role;
        const role =
            roleFromCookie === 'teacher' || roleFromCookie === 'student'
                ? roleFromCookie
                : getRoleFromState(req.query?.state as string | undefined);
        console.log('[OAuth][Facebook] Role resolution', {
            email: user.email,
            roleFromCookie,
            state: req.query?.state,
            resolvedRole: role,
        });
        const result = await this.authService.facebookLogin(user, undefined, role);
        done(null, result);
    }
}
