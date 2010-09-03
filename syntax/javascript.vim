"============================================================================
"File:        javascript.vim
"Description: Syntax checking plugin for syntastic.vim
"Maintainer:  Vinicius Baggio Fuentes  vinibaggio at gmail dot com
"License:     This program is free software. It comes without any warranty,
"             to the extent permitted by applicable law. You can redistribute
"             it and/or modify it under the terms of the Do What The Fuck You
"             Want To Public License, Version 2, as published by Sam Hocevar.
"             See http://sam.zoy.org/wtfpl/COPYING for more details.
"
"============================================================================
if exists("loaded_node_javascript_syntax_checker")
    finish
endif
let loaded_node_javascript_syntax_checker = 1

"bail if the user doesnt have jsl installed
if !executable("jslint")
    finish
endif

function! SyntaxCheckers_javascript_GetLocList()
    let makeprg = "jslint %"
    let errorformat='%W%\s%\+%n\ %l\,%c:\ %m'
    let loclist = SyntasticMake({ 'makeprg': makeprg, 'errorformat': errorformat })

    "the file name isnt in the output so stick in the buf num manually
    for i in loclist
        let i['bufnr'] = bufnr("")
    endfor
    return loclist
endfunction
