import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Res, UseGuards, UseInterceptors, UploadedFile, Injectable, CanActivate, ExecutionContext, ForbiddenException, StreamableFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PintuanStore } from './pintuan.store';

@Injectable()
class SameOriginWrite implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{ method: string; headers: Record<string, string> }>();
    if (req.method !== 'GET' && req.headers['x-pintuan-request'] !== '1') throw new ForbiddenException('请从拼团页面提交操作。');
    return true;
  }
}
@Controller('pintuan')
@UseGuards(SameOriginWrite)
export class PintuanController {
  constructor(private readonly store: PintuanStore) {}
  @Post('auth/login')
  login(@Body() body: unknown, @Headers('cookie') cookie: string | undefined, @Res({ passthrough: true }) res: { setHeader: (name: string, value: string) => void }) {
    const result = this.store.login(body);
    this.store.logout(cookie);
    res.setHeader('Set-Cookie', `pintuan_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    return result.account;
  }
  @Get('auth/me') me(@Headers('cookie') cookie: string | undefined) { return this.store.account(cookie); }
  @Post('auth/logout') logout(@Headers('cookie') cookie: string | undefined, @Res({ passthrough: true }) res: { setHeader: (name: string, value: string) => void }) {
    this.store.logout(cookie); res.setHeader('Set-Cookie', 'pintuan_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); return { loggedOut: true };
  }
  @Get('groups') publicList() { return this.store.list(); }
  @Get('groups/:id') publicDetail(@Param('id') id: string) { return this.store.get(id); }
  @Get('leader/groups') list(@Headers('cookie') cookie: string | undefined) { return this.store.list(this.store.leader(cookie)); }
  @Get('leader/groups/:id') detail(@Headers('cookie') cookie: string | undefined, @Param('id') id: string) { return this.store.get(id, this.store.leader(cookie)); }
  @Post('leader/groups') create(@Headers('cookie') cookie: string | undefined, @Body() body: unknown) { return this.store.create(this.store.leader(cookie), body); }
  @Put('leader/groups/:id') save(@Headers('cookie') cookie: string | undefined, @Param('id') id: string, @Body() body: unknown) { return this.store.save(this.store.leader(cookie), id, body); }
  @Delete('leader/groups/:id') remove(@Headers('cookie') cookie: string | undefined, @Param('id') id: string, @Body() body: unknown) { return this.store.remove(this.store.leader(cookie), id, body); }
  @Post('leader/groups/:id/preview') preview(@Headers('cookie') cookie: string | undefined, @Param('id') id: string, @Body() body: unknown) { return this.store.preview(this.store.leader(cookie), id, body); }
  @Post('leader/groups/:id/publish') publish(@Headers('cookie') cookie: string | undefined, @Param('id') id: string, @Body() body: unknown) { return this.store.publish(this.store.leader(cookie), id, body); }
  @Post('media')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  upload(@Headers('cookie') cookie: string | undefined, @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined) { return this.store.upload(this.store.leader(cookie), file); }
  @Get('media/:id') image(@Headers('cookie') cookie: string | undefined, @Param('id') id: string) {
    const image = this.store.image(id, this.store.account(cookie, false));
    return new StreamableFile(Buffer.from(image.bytes), { type: image.mime, disposition: 'inline' });
  }
}
