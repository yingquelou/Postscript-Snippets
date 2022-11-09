# Operator Summary

## Operand Stack Manipulation Operators

|param|operator|returns|remarks
|-|-|-|-
|any|pop||Discard top element
|any1 any2|exch|any2 any1|Exchange top two elements
|any|dup|any any|Duplicate top element
|any1…anyn n|copy|any1…anyn any1…anyn|Duplicate topn elements
|anyn…any0 n|index|anyn…any0 anyn|Duplicate arbitrary element
|any(n-1)…any0 n j|roll|any(j-1)modn…any0 any(n-1)…anyjmodn|Rolln elements up j times
|any1…anyn|clear||Discard all elements
|any1…anyn|count|any1…anyn n|Count elements on stack
|mark|mark||Push mark on stack
|mark obj1…objn|cleartomark||Discard elements down through mark
|mark obj1…objn|counttomark|mark obj1…objn n|Count elements down to mark

## Arithmetic and Math Operators

|param|operator|returns|remarks
|-|-|-|-
|num1 num2|add|sum|Return num1 plus num2
|num1 num2|div|quotient|Return num1 divided by num2
|int1 int2|idiv|quotient|Return int1 divided by int2
|int1 int2|mod|remainder|Return remainder after dividing int1 by int2
|num1 num2|mul|product|Return num1 times num2
|num1 num2|sub|difference|Return num1 minus num2
|num1|abs|num2|Return absolute value of num1
|num1|neg|num2|Return negative of num1
|num1|ceiling|num2|Return ceiling of num1
|num1|floor|num2|Return floor of num1
|num1|round|num2|Round num1 to nearest integer
|num1|truncate|num2|Remove fractional part of num1
|num|sqrt|real|Return square root of num
|num den|atan|angle|Return arctangent of num/den in degrees
|angle|cos|real|Return cosine of angle degrees
|angle|sin|real|Return sine of angle degrees
|base exponent|exp|real|Raise base to exponent power
|num|ln|real|Return natural logarithm (base e)
|num|log|real|Return common logarithm (base10)
||rand|int|Generate pseudo-random integer
|int|srand||Set random number seed
||rrand|int|Return random number seed

## Array Operators

|param|operator|returns|remarks
|-|-|-|-
|int|array|array|Create array of length int
||[|mark|Start array construction
|mark obj0…obj(n-1)|]|array|End array construction
|array|length|int|Return number of elements in array
|array index|get|any|Return array element indexed by index
|array index any|put||Put any into array at index
|array index count|getinterval|subarray|Return subarray of array starting at index for count elements
|array1 index array2,packedarray2|putinterval||Replace subarray of array1 starting at index by array2,packedarray2
|any0…any(n-1) array|astore|array|Pop elements from stack into array
|array|aload|any0…any(n-1) array|Push all elements of array on stack
|array1 array2|copy|subarray2|Copy elements of array1 to initial subarray of array2
|array proc|forall||Execute proc for each element of array

## Packed Array Operators

|param|operator|returns|remarks
|-|-|-|-
|any0…any(n-1) n|packedarray|packedarray|Create packed array consisting ofn elements from stack
|bool|setpacking||Set array packing mode for {…} syntax (true = packed array)
||currentpacking|bool|Return array packing mode
|packedarray|length|int|Return number of elements in packedarray
|packedarray index|get|any|Return packedarray element indexed by index
|packedarray index count|getinterval|subarray|Return subarray of packedarray starting at index for count elements
|packedarray|aload|any0…any(n-1) packedarray|Push all elements of packedarray on stack
|packedarray1 array2|copy|subarray2|Copy elements of packedarray1 to initial subarray of array2
|packedarray proc|forall||Execute proc for each element of packedarray

## Dictionary Operators

|param|operator|returns|remarks
|-|-|-|-
|int|dict|dict|Create dictionary with capacity for int elements
||<<|mark|Start dictionary construction
|mark key1 value1…keyn valuen|>>|dict|End dictionary construction
|dict|length|int|Return number of entries in dict
|dict|maxlength|int|Return current capacity of dict
|dict|begin||Push dict on dictionary stack
||end||Pop current dictionary off dictionary stack
|key value|def||Associate key and value in current dictionary
|key|load|value|Search dictionary stack for key and return associated value
|key value|store||Replace topmost definition of key
|dict key|get|any|Return value associated with key in dict
|dict key value|put||Associate key with value in dict
|dict key|undef||Remove key and its value from dict
|dict key|known|bool|Test whether key is in dict
|key|where|dict true or false|Find dictionary in which key is defined
|dict1 dict2|copy|dict2|Copy contents of dict1 to dict2
|dict proc|forall||Execute proc for each entry in dict
||currentdict|dict|Return current dictionary
||errordict|dict|Return error handler dictionary
||$error|dict|Return error control and status dictionary
||systemdict|dict|Return system dictionary
||userdict|dict|Return writeable dictionary in local VM
||globaldict|dict|Return writeable dictionary in global VM
||statusdict|dict|Return product-dependent dictionary
||countdictstack|int|Count elements on dictionary stack
|array|dictstack|subarray|Copy dictionary stack into array
||cleardictstack||Pop all nonpermanent dictionaries off dictionary stack

## String Operators

|param|operator|returns|remarks
|-|-|-|-
|int|string|string|Create string of length int
|string|length|int|Return number of elements in string
|string index|get|int|Return string element indexed by index
|string index int|put||Put int into string at index
|string index count|getinterval|substring|Return substring of string starting at index for count elements
|string1 index string2|putinterval||Replace substring of string1 starting at index by string2
|string1 string2|copy|substring2|Copy elements of string1 to initial substring of string2
|string proc|forall||Execute proc for each element of string
|string seek|anchorsearch|post match true or string false|Search for seek at start of string
|string seek|search|post match pre true or string false|Search for seek in string
|string|token|post any true or false|Read token from start of string

## Relational,Boolean,and Bitwise Operators

|param|operator|returns|remarks
|-|-|-|-
|any1 any2|eq|bool|Test equal
|any1 any2|ne|bool|Test not equal
|num1,str1 num2,str2|ge|bool|Test greater than or equal
|num1,str1 num2,str2|gt|bool|Test greater than
|num1,str1 num2,str2|le|bool|Test less than or equal
|num1,str1 num2,str2|lt|bool|Test less than
|bool1,int1 bool2,int2|and|bool3,int3|Perform logical,bitwise and
|bool1,int1|not|bool2,int2|Perform logical,bitwise not
|bool1,int1 bool2,int2|or|bool3,int3 Perform logical|bitwise inclusive or
|bool1,int1 bool2,int2|xor|bool3,int3|Perform logical,bitwise exclusive or
||true|true|Return boolean value true
||false|false|Return boolean value false
|int1 shift|bitshift|int2|Perform bitwise shift of int1 (positive is left)

## Control Operators

|param|operator|returns|remarks
|-|-|-|-
|any|exec||Execute arbitrary object
|bool proc|if||Execute proc if bool is true
|bool proc1 proc2|ifelse||Execute proc1 if bool is true,proc2 if false
|initial increment limit proc|for||Execute proc with values from initial by steps of increment to limit
|int proc|repeat||Execute proc int times
|proc|loop||Execute proc an indefinite number of times
||exit||Exit innermost active loop
||stop||Terminate stopped context
|any|stopped|bool|Establish context for catching stop
||countexecstack|int|Count elements on execution stack
|array|execstack|subarray|Copy execution stack into array
||quit||Terminate interpreter
||start||Executed at interpreter startup

## Type,Attribute,and Conversion Operators

|param|operator|returns|remarks
|-|-|-|-
|any|type|name|Return type of any
|any|cvlit|any|Make object literal
|any|cvx|any|Make object executable
|any|xcheck|bool|Test executable attribute
|array,packedarray,file,string|executeonly|array,packedarray,file,string|Reduce access to execute-only
|array,packedarray,dict,file,string|noaccess|array,packedarray,dict,file,string|Disallow any access
|array,packedarray,dict,file,string|readonly|array,packedarray,dict,file,string|Reduce access to read-only
|array,packedarray,dict,file,string|rcheck|bool|Test read access
|array,packedarray,dict,file,string|wcheck|bool|Test write access
|num,string|cvi|int|Convert to integer
|string|cvn|name|Convert to name
|num,string|cvr|real|Convert to real
|num radix string|cvrs|substring|Convert with radix to string
|any string|cvs|substring|Convert to string

## File Operators

|param|operator|returns|remarks
|-|-|-|-
|filename access|file|file|Open named file with specified access
|datasrc,datatgt dict|filter|file|Establish filtered file 1
|param1…paramn filtername|filter|file|Establish filtered file 2
|file|closefile||Close file
|file|read|int true or false|Read one character from file
|file int|write||Write one character to file
|file string|readhexstring|substring bool|Read hexadecimal numbers from file into string
|file string|writehexstring||Write string to file as hexadecimal
|file string|readstring|substring bool|Read string from file
|file string|writestring||Write string to file
|file string|readline|substring bool|Read line from file into string
|file|token|any true or false|Read token from file
|file|bytesavailable|int|Return number of bytes available to read
||flush||Send buffered data to standard output file
|file|flushfile||Send buffered data or read to EOF
|file|resetfile||Discard buffered characters
|file|status|bool|Return status of file (true = valid)
|filename|status|pages bytes referenced created true or false|Return information about named file
|filename|run||Execute contents of named file
||currentfile|file|Return file currently being executed
|filename|deletefile||Delete named file
|filename1 filename2|renamefile||Rename file filename1 to filename2
|template proc scratch|filenameforall||Execute proc for each file name matching template
|file position|setfileposition||Set file to specified position
|file|fileposition|position|Return current position in file
|string|print||Write string to standard output file
|any|=||Write text representation of any to standard output file
|any|==||Write syntactic representation of any to standard output file
|any1…anyn|stack|any1…anyn|Print stack nondestructively using =
|any1…anyn|pstack|any1…anyn|Print stack nondestructively using ==
|obj tag|printobject||Write binary object to standard output file,using tag
|file obj tag|writeobject||Write binary object to file,using tag
|int|setobjectformat||Set binary object format (0 = disable,1 = IEEE high,2 = IEEE low,3 = native high,4 = native low)
||currentobjectformat|int|Return binary object format

## Resource Operators

|param|operator|returns|remarks
|-|-|-|-
|key instance category|defineresource|instance|Register named resource instance in category
|key category|undefineresource||Remove resource registration
|key category|findresource|instance|Return resource instance identified by key in category
|renderingintent|findcolorrendering|name bool|Select CIE-based color rendering dictionary by rendering intent
|key category|resourcestatus|status size true or false|Return status of resource instance
|template proc scratch category|resourceforall||Enumerate resource instances in category

## Virtual Memory Operators

|param|operator|returns|remarks
|-|-|-|-
||save|save|Create VM snapshot
|save|restore||Restore VM snapshot
|bool|setglobal||Set VM allocation mode (false = local,true = global)
||currentglobal|bool|Return current VM allocation mode
|any|gcheck|bool|Return true if any is simple or in global VM,false if in local VM
|bool1 password|startjob|bool2|Start new job that will alter initial VM if bool1 is true
|index any|defineuserobject||Define user object associated with index
|index|execuserobject||Execute user object associated with index
|index|undefineuserobject||Remove user object associated with index
||UserObjects|array|Return current UserObjects array defined in userdict

## Miscellaneous Operators

|param|operator|returns|remarks
|-|-|-|-
|proc|bind|proc|Replace operator names in proc with operators; perform idiom recognition
||null|null|Push null on stack
||version|string|Return interpreter version
||realtime|int|Return real time in milliseconds
||usertime|int|Return execution time in milliseconds
||languagelevel|int|Return LanguageLevel
||product|string|Return product name
||revision|int|Return product revision level
||serialnumber|int|Return machine serial number
||executive||Invoke interactive executive
|bool|echo||Turn echoing on or off
||prompt||Executed when ready for interactive input

## Graphics State Operators (Device-Independent)

|param|operator|returns|remarks
|-|-|-|-
||gsave||Push graphics state
||grestore||Pop graphics state
||clipsave||Push clipping path
||cliprestore||Pop clipping path
||grestoreall||Pop to bottommost graphics state
||initgraphics||Reset graphics state parameters
||gstate|gstate|Create graphics state object
|gstate|setgstate||Set graphics state from gstate
|gstate|currentgstate|gstate|Copy current graphics state into gstate
|num|setlinewidth||Set line width
||currentlinewidth|num|Return current line width int setlinecap-Set shape of line ends for stroke (0 = butt,1 = round,2 = square)
||currentlinecap|int|Return current line cap
|int|setlinejoin||Set shape of corners for stroke (0 = miter,1 = round,2 = bevel)
||currentlinejoin|int|Return current line join
|num|setmiterlimit||Set miter length limit
||currentmiterlimit|num|Return current miter limit
|bool|setstrokeadjust||Set stroke adjustment (false = disable,true = enable)
||currentstrokeadjust|bool|Return current stroke adjustment
|array offset|setdash||Set dash pattern for stroking
||currentdash|array offset|Return current dash pattern
|array,name|setcolorspace||Set color space
||currentcolorspace|array|Return current color space
|comp1…compn|setcolor||Set color components
|pattern|setcolor||Set colored tiling pattern as current color
|comp1…compn pattern|setcolor||Set uncolored tiling pattern as current color
||currentcolor|comp1…comp n|Return current color components
|num|setgray||Set color space to DeviceGray and color to specified gray value (0 = black,1 = white)
||currentgray|num|Return current color as gray value
|hue saturation brightness|sethsbcolor||Set color space to DeviceRGB and color to specified hue,saturation,brightness
||currenthsbcolor|hue saturation brightness|Return current color as hue,saturation,brightness
|red green blue|setrgbcolor||Set color space to DeviceRGB and color to specified red,green,blue
||currentrgbcolor|red green blue|Return current color as red,green,blue
|cyan magenta yellow black|setcmykcolor||Set color space to DeviceCMYK and color to specified cyan,magenta,yellow,black
||currentcmykcolor|cyan magenta yellow black|Return current color as cyan,magenta,yellow,black

## Graphics State Operators (Device-Dependent)

|param|operator|returns|remarks
|-|-|-|-
|halftone|sethalftone||Set halftone dictionary
||currenthalftone|halftone|Return current halftone dictionary
|frequency angle proc|setscreen||Set gray halftone screen by frequency,angle,and spot function
|frequency angle halftone|setscreen||Set gray halftone screen from halftone dictionary
||currentscreen|frequency angle proc,halftone|Return current gray halftone screen
|redfreq redang redproc,redhalftone|setcolorscreen||Set all four halftone screens 1
|greenfreq greenang greenproc,greenhalftone|setcolorscreen||Set all four halftone screens 2
|bluefreq blueang blueproc,bluehalftone|setcolorscreen||Set all four halftone screens 3
|grayfreq grayang grayproc,grayhalftone|setcolorscreen||Set all four halftone screens 4
||currentcolorscreen|redfreq redang redproc,redhalftone;greenfreq greenang greenproc,greenhalftone;bluefreq blueang blueproc,bluehalftone;grayfreq grayang grayproc,grayhalftone|Return all four halftone screens
|proc|settransfer||Set gray transfer function
||currenttransfer|proc|Return current gray transfer function
|redproc greenproc blueproc grayproc|setcolortransfer||Set all four transfer functions
||currentcolortransfer|redproc greenproc blueproc grayproc|Return current transfer functions
|proc|setblackgeneration||Set black-generation function
||currentblackgeneration|proc|Return current black-generation function
|proc|setundercolorremoval||Set undercolor-removal function
||currentundercolorremoval|proc|Return current undercolor-removal function
|dict|setcolorrendering||Set CIE-based color rendering dictionary
||currentcolorrendering|dict|Return current CIE-based color rendering dictionary
|num|setflat||Set flatness tolerance
||currentflat|num|Return current flatness
|bool|setoverprint||Set overprint parameter
||currentoverprint|bool|Return current overprint parameter
|num|setsmoothness||Set smoothness parameter
||currentsmoothness|num|Return current smoothness parameter

## Coordinate System and Matrix Operators

|param|operator|returns|remarks
|-|-|-|-
||matrix|matrix|Create identity matrix
||initmatrix||Set CTM to device default
|matrix|identmatrix|matrix|Fill matrix with identity transform
|matrix|defaultmatrix|matrix|Fill matrix with device default matrix
|matrix|currentmatrix|matrix|Fill matrix with CTM
|matrix|setmatrix||Replace CTM by matrix
|tx ty|translate||Translate user space by (tx,ty)
|tx ty matrix|translate|matrix|Define translation by (tx,ty)
|sx sy|scale||Scale user space by sx and sy
|sx sy matrix|scale|matrix|Define scaling by sx and sy
|angle|rotate||Rotate user space by angle degrees
|angle matrix|rotate|matrix|Define rotation by angle degrees
|matrix|concat||Replace CTM by matrix × CTM
|matrix1 matrix2 matrix3|concatmatrix|matrix3|Fill matrix3 with matrix1 × matrix2
|x y|transform|x′ y′|Transform (x,y) by CTM
|x y matrix|transform|x′ y′|Transform (x,y) by matrix
|dx dy|dtransform|dx′ dy′|Transform distance (dx,dy) by CTM
|dx dy matrix|dtransform|dx′ dy′|Transform distance (dx,dy) by matrix
|x′ y′|itransform|x y|Perform inverse transform of (x′,y′) by CTM
|x′ y′ matrix|itransform|x y|Perform inverse transform of (x′,y′) by matrix
|dx′ dy′|idtransform|dx dy|Perform inverse transform of distance (dx′,dy′) by CTM
|dx′ dy′ matrix|idtransform|dx dy|Perform inverse transform of distance (dx′,dy′) by matrix
|matrix1 matrix2|invertmatrix|matrix2|Fill matrix2 with inverse of matrix1

## Path Construction Operators

|param|operator|returns|remarks
|-|-|-|-
||newpath||Initialize current path to be empty
||currentpoint|x y|Return current point coordinates
|x y|moveto||Set current point to (x,y)
|dx dy|rmoveto||Perform relative moveto
|x y|lineto||Append straight line to (x,y)
|dx dy|rlineto||Perform relative lineto
|x y r angle1 angle2|arc||Append counterclockwise arc
|x y r angle1 angle2|arcn||Append clockwise arc
|x1 y1 x2 y2 r|arct||Append tangent arc
|x1 y1 x2 y2 r|arcto|xt1 yt1 xt2 yt2|Append tangent arc
|x1 y1 x2 y2 x3 y3|curveto||Append Bézier cubic section
|dx1 dy1 dx2 dy2 dx3 dy3|rcurveto||Perform relative curveto
||closepath||Connect subpath back to its starting point
||flattenpath||Convert curves to sequences of straight lines
||reversepath||Reverse direction of current path
||strokepath||Compute outline of stroked path
|userpath|ustrokepath||Compute outline of stroked userpath
|userpath matrix|ustrokepath||Compute outline of stroked userpath
|string bool|charpath||Append glyph outline to current path
|userpath|uappend||Interpret userpath and append to current path
||clippath||Set current path to clipping path
|llx lly urx ury|setbbox||Set bounding box for current path
||pathbbox|llx lly urx ury|Return bounding box of current path
|move line curve close|pathforall||Enumerate current path
|bool|upath|userpath|Create userpath for current path; include ucache if bool is true
||initclip||Set clipping path to device default
||clip||Clip using nonzero winding number rule
||eoclip||Clip using even-odd rule
|x y width height|rectclip||Clip with rectangular path
|numarray,numstring|rectclip||Clip with rectangular paths
||ucache||Declare that user path is to be cached

## Painting Operators

|param|operator|returns|remarks
|-|-|-|-
||erasepage||Paint current page white
||stroke||Draw line along current path
||fill||Fill current path with current color
||eofill||Fill using even-odd rule
|x y width height|rectstroke||Define rectangular path and stroke
|x y width height matrix|rectstroke||Define rectangular path,concatenate matrix,and stroke
|numarray,numstring|rectstroke||Define rectangular paths and stroke
|numarray,numstring matrix|rectstroke||Define rectangular paths,concatenate matrix,and stroke
|x y width height|rectfill||Fill rectangular path
|numarray,numstring|rectfill||Fill rectangular paths
|userpath|ustroke||Interpret and stroke userpath
|userpath matrix|ustroke||Interpret userpath,concatenate matrix,and stroke
|userpath|ufill||Interpret and fill userpath
|userpath|ueofill||Fill userpath using even-odd rule
|dict|shfill||Fill area defined by shading pattern
|dict|image||Paint any sampled image
|width height bits/sample matrix datasrc|image||Paint monochrome sampled image
|width height bits/comp matrix|colorimage||Paint color sampled image 1
|datasrc0…datasrc(ncomp-1) multi ncomp|colorimage||Paint color sampled image 2
|dict|imagemask||Paint current color through mask
|width height polarity matrix datasrc|imagemask||Paint current color through mask

## Insideness-Testing Operators

|param|operator|returns|remarks
|-|-|-|-
|x y|infill|bool|Test whether (x,y) would be painted by fill
|userpath|infill|bool|Test whether pixels in userpath would be painted by fill
|x y|ineofill|bool|Test whether (x,y) would be painted by eofill
|userpath|ineofill|bool|Test whether pixels in userpath would be painted by eofill
|x y userpath|inufill|bool|Test whether (x,y) would be painted by ufill of userpath
|userpath1 userpath2|inufill|bool|Test whether pixels in userpath1 would be painted by ufill of userpath2
|x y userpath|inueofill|bool|Test whether (x,y) would be painted by ueofill of userpath
|userpath1 userpath2|inueofill|bool|Test whether pixels in userpath1 would be painted by ueofill of userpath2
|x y|instroke|bool|Test whether (x,y) would be painted by stroke
|x y userpath|inustroke|bool|Test whether (x,y) would be painted by ustroke of userpath
|x y userpath matrix|inustroke|bool|Test whether (x,y) would be painted by ustroke of userpath
|userpath1 userpath2|inustroke|bool|Test whether pixels in userpath1 would be painted by ustroke of userpath2
|userpath1 userpath2 matrix|inustroke|bool|Test whether pixels in userpath1 would be painted by ustroke of userpath2

## Form and Pattern Operators

|param|operator|returns|remarks
|-|-|-|-
|pattern matrix|makepattern|pattern’|Create pattern instance from prototype
|pattern|setpattern||Install pattern as current color
|comp1…compn pattern|setpattern||Install pattern as current color
|form|execform||Paint form

## Device Setup and Output Operators

|param|operator|returns|remarks
|-|-|-|-
||showpage||Transmit and reset current page
||copypage||Transmit current page
|dict|setpagedevice||Install page-oriented output device
||currentpagedevice|dict|Return current page device parameters
||nulldevice||Install no-output device

## Glyph and Font Operators

|param|operator|returns|remarks
|-|-|-|-
|key font,cidfont|definefont|font,cidfont|Register font,cidfont in Font resource category
|key name,string,dict array|composefont|font|Register composite font dictionary created from,CMap and array of CIDFonts or fonts
|key|undefinefont||Remove Font resource registration
|key|findfont|font,cidfont|Return Font resource instance identified by key
|font,cidfont scale|scalefont|font′,cidfont′|Scale font,cidfont by scale to produce font′,cidfont′
|font,cidfont matrix|makefont|font′,cidfont′|Transform font,cidfont by matrix to produce font′,cidfont′
|font,cidfont|setfont||Set font or CIDFont in graphics state
||rootfont|font,cidfont|Return last set font or CIDFont
||currentfont|font,cidfont|Return current font or CIDFont,possibly a descendant of rootfont
|key scale,matrix|selectfont||Set font or CIDFont given name and transform
|string|show||Paint glyphs for string in current font
|ax ay string|ashow||Add (ax,ay) to width of each glyph while showing string
|cx cy char string|widthshow||Add (cx,cy) to width of glyph for char while showing string
|cx cy char ax ay string|awidthshow||Combine effects of ashow and widthshow
|string numarray,numstring|xshow||Paint glyphs for string using x widths in numarray,numstring
|string numarray,numstring|xyshow||Paint glyphs for string using x and y widths in numarray,numstring
|string numarray,numstring|yshow||Paint glyphs for string using y widths in numarray,numstring
|name,cid|glyphshow||Paint glyph for character identified by name,cid
|string|stringwidth|wx wy|Return width of glyphs for string in current font
|proc string|cshow||Invoke character mapping algorithm and call proc
|proc string|kshow||Execute proc between characters shown from string
||FontDirectory|dict|Return dictionary of Font resource instances
||GlobalFontDirectory|dict|Return dictionary of Font resource instances in global,VM
||StandardEncoding|array|Return Adobe standard font encoding vector
||ISOLatin1Encoding|array|Return ISO Latin-1 font encoding vector
|key|findencoding|array|Find encoding vector
|wx wy llx lly urx ury|setcachedevice||Declare cached glyph metrics
|w0x w0y llx lly urx ury|setcachedevice2||Declare cached glyph metrics 1
|w1x w1y vx vy|setcachedevice2||Declare cached glyph metrics 2
|wx wy|setcharwidth||Declare uncached glyph metrics

## Interpreter Parameter Operators

|param|operator|returns|remarks
|-|-|-|-
|dict|setsystemparams||Set systemwide interpreter parameters
||currentsystemparams|dict|Return systemwide interpreter parameters
|dict|setuserparams||Set per-context interpreter parameters
||currentuserparams|dict|Return per-context interpreter parameters
|string dict|setdevparams||Set parameters for input/output device
|string|currentdevparams|dict|Return device parameters
|int|vmreclaim||Control garbage collector
|int|setvmthreshold||Control garbage collector
||vmstatus|level used maximum|Report VM status
||cachestatus|bsize bmax msize mmax csize cmax blimit|Return font cache status and parameters
|int|setcachelimit||Set maximum bytes in cached glyph
|mark size lower upper|setcacheparams||Set font cache parameters
||currentcacheparams|mark size lower upper|Return current font cache parameters
|mark blimit|setucacheparams||Set user path cache parameters
||ucachestatus|mark bsize bmax rsize rmax blimit|Return user path cache status and parameters

## Errors

|param|operator|returns|remarks
|-|-|-|-
||configurationerror||setpagedevice or setdevparams request cannot be satisfied
||dictfull||No more room in dictionary
||dictstackoverflow||Too many begin operators
||dictstackunderflow||Too many end operators
||execstackoverflow||Executive stack nesting too deep
||handleerror||Called to report error information
||interrupt||External interrupt request (for example,Control-C)
||invalidaccess||Attempt to violate access attribute
||invalidexit||exit not in loop
||invalidfileaccess||Unacceptable access string
||invalidfont||Invalid Font resource name or font or CIDFont dictionary
||invalidrestore||Improper restore
||ioerror||Input/output error
||limitcheck||Implementation limit exceeded
||nocurrentpoint||Current point undefined
||rangecheck||Operand out of bounds
||stackoverflow||Operand stack overflow
||stackunderflow||Operand stack underflow
||syntaxerror||PostScript language syntax error
||timeout||Time limit exceeded
||typecheck||Operand of wrong type
||undefined||Name not known
||undefinedfilename||File not found
||undefinedresource||Resource instance not found
||undefinedresult||Overflow,underflow,or meaningless result
||unmatchedmark||Expected mark not on stack
||unregistered||Internal error
||VMerror||Virtual memory exhausted
