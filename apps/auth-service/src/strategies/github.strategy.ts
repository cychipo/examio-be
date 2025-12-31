import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile, StrategyOptions } from 'passport-github2';
import { AuthService } from '../auth.service';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
    constructor(private authService: AuthService) {
        super({
            clientID: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            callbackURL: process.env.GITHUB_CALLBACK_URL,
            scope: ['user:email'],
        } as StrategyOptions);
    }

    async validate(
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

        const result = await this.authService.githubLogin(user);
        done(null, result);
    }
}
