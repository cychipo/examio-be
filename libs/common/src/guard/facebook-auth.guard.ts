import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class FacebookAuthGuard extends AuthGuard('facebook') {
    canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        const response = context.switchToHttp().getResponse();
        const role = request.query?.role;
        const redirect = request.query?.redirect;

        if (typeof role === 'string') {
            response.cookie('oauth_role', role, {
                httpOnly: true,
                sameSite: 'lax',
                secure: false,
                maxAge: 10 * 60 * 1000,
            });
        }

        if (typeof redirect === 'string') {
            response.cookie('oauth_redirect', redirect, {
                httpOnly: true,
                sameSite: 'lax',
                secure: false,
                maxAge: 10 * 60 * 1000,
            });
        }

        return super.canActivate(context);
    }

    getAuthenticateOptions(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        const state = request.query?.state;

        return typeof state === 'string' ? { state } : {};
    }
}
