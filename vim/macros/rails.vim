command! -nargs=0 Rschema :1R db/schema.rb
command! -nargs=0 RSschema :RSfind db/schema.rb
command! -nargs=0 RVschema :RVfind db/schema.rb
command! -nargs=0 RTschema :RTfind db/schema.rb

command! -nargs=0 Rfactories :1R spec/factories.rb
command! -nargs=0 RSfactories :RSfind spec/factories.rb
command! -nargs=0 RVfactories :RVfind spec/factories.rb
command! -nargs=0 RTfactories :RTfind spec/factories.rb

command! -nargs=0 Rroutes :1R config/routes.rb
command! -nargs=0 RSroutes :RSfind config/routes.rb
command! -nargs=0 RVroutes :RVfind config/routes.rb
command! -nargs=0 RTroutes :RTfind config/routes.rb

