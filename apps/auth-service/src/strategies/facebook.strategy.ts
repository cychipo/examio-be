import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
    Strategy,
    StrategyOptionsWithRequest,
    Profile,
} from 'passport-facebook';
import { AuthService } from '../auth.service';

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

        const result = await this.authService.facebookLogin(user);
        done(null, result);
    }
}
