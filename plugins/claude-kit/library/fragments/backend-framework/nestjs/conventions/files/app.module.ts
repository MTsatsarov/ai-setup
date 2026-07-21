import { Module } from '@nestjs/common';
<% if orm.nest_module_import %><% orm.nest_module_import %>
<% end %>
@Module({
  imports: [<% if orm.nest_module %><% orm.nest_module %><% end %>],
  controllers: [],
  providers: [],
})
export class AppModule {}
