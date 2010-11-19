"=============================================================================
" File: increment.vim
" Author: Stanislav Sitar (sitar@procaut.sk)
" Help:
" Put increment.vim into a plugin directory.
" Use in replacement strings
" :%s/my_token_word_to_be_replaced_by_the_auto_incremented_numbers/\=Inc(1)/
" or
" :let IncIdx=95
" :%s/@/\=Inc(5)/
" to replace each occurrence of character @ with numbers starting with 100 and 
" growing by 5 (100, 105, 110, ...)
"=========================================================================

"function! Increment(...) range
"
"    " save line numbers
"    let lfirst=a:firstline
"    let llast=a:lastline
"
"    " get increment (default=1)
"    let incr= 1
"    if a:0 > 0
"        let incr= a:1
"    endif
"
"    " get starting value (default=0)
"    let startValue= 0
"    if a:0 > 1
"        let startValue= a:2
"    endif
"
"    " get pattern (default=@)
"    let pattern= "@"
"    if a:0 > 2
"        let pattern= a:3
"    endif
"
"    let val=startValue
"    let lineNb=lfirst
"    while lineNb <= llast
"        silent! execute lineNb."s/".pattern."/".val."/"
"	    let val= val + incr
"	    let lineNb= lineNb + 1
"    endwhile
"
"endfunction
"
"command! -n=* -range Inc :<line1>,<line2>call Increment(<f-args>)

let g:IncIncr = 1
let g:IncStartVal = 0
let g:IncMatchPat = "@"

function! Increment(...) range

    " Arguments to the function:
    "   range with firstline and lastline
    "   [i<number>] to change the increment between two consecutive matching lines
    "   [s<number>] to change the starting value
    "   [p<regexp>] to change the pattern

    " save line numbers
    let lfirst = a:firstline
    let llast = a:lastline

    " Defaults
    let incr = g:IncIncr
    let startingValue = g:IncStartVal
    let pattern = g:IncMatchPat

    " Get arguments
    " Change letter with a command setting the appropriate value
    let nargs = 1
    while nargs <= a:0
        let toex = ""
        if a:{nargs} =~? "^i"
            let toex = substitute(a:{nargs},"^i","let incr = ","")
        elseif a:{nargs} =~? "^s"
            let toex = substitute(a:{nargs},"^s","let startingValue = ","")
        elseif a:{nargs} =~? "^p"
            let toex = substitute(a:{nargs},"^p","let pattern = \"","")
            let toex = substitute(toex,"$","\"","")
        else
            " Ignore
            let toex = ""
        endif
        execute toex
        let nargs = nargs + 1
    endwhile

    let val = startingValue
    silent! execute lfirst
    let lineNb = line(".")
    while search(pattern, "W")
        let lineNb = line(".")
        if lineNb > llast
            break
        endif
        silent! execute lineNb."s/".pattern."/".val."/"
	    let val = val + incr
    endwhile

endfunction

" Command syntax:
"
"   :[line1,line2]Inc [i<number>] [s<number>] [p<string>]
"
"   [i<number>] to change the increment between two consecutive matching lines
"   [s<number>] to change the starting value
"   [p<number>] to change the pattern

command! -n=* -range Inc :<line1>,<line2>call Increment(<f-args>)

