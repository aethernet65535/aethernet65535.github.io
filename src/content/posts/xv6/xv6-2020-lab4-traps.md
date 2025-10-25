---
title: "XV6-2020: LAB4-TRAPS"
published: 2025-06-15
description: "初步理解陷阱"
image: "./lab4.jpg"
tags: ["xv6"]
category: OS
draft: false
---

## risc-v assembly (easy)
这个LAB没有多难，看汇编而已，如果有一些经验的的话几分钟就能大致理解了。       
首先，我们先生成`call.asm`，然后我们就能依次看问题了！        
基本只要看这部分就行了：        
```sh
000000000000001c <main>:

void main(void) {
  1c:	1141                	addi	sp,sp,-16
  1e:	e406                	sd	ra,8(sp)
  20:	e022                	sd	s0,0(sp)
  22:	0800                	addi	s0,sp,16
  printf("%d %d\n", f(8)+1, 13);
  24:	4635                	li	a2,13
  26:	45b1                	li	a1,12
  28:	00000517          	auipc	a0,0x0
  2c:	7c050513          	addi	a0,a0,1984 # 7e8 <malloc+0xea>
  30:	00000097          	auipc	ra,0x0
  34:	610080e7          	jalr	1552(ra) # 640 <printf>
  exit(0);
  38:	4501                	li	a0,0
  3a:	00000097          	auipc	ra,0x0
  3e:	27e080e7          	jalr	638(ra) # 2b8 <exit>
```

### 第一个问题：
Which registers contain arguments to functions? For example, which register holds 13 in `main`'s call to `printf`? 

中文翻译：    
哪些寄存器用于传递函数参数？比如，`main`调用`printf`时，数字13存在于哪个寄存器中？

解答：    
明显，很明显，我们先找到`13`在哪，在`a2`那里，所以答案就是`a2`。
```sh
li a2, 13 # 了解x86的读者可以暂时理解为mov a2, 13
```

### 第二个问题：
Where is the call to function `f` in the assembly code for `main`? Where is the call to `g`? (Hint: the compiler may inline functions.) 

中文翻译：    
在这个汇编的`main`函数，`f`和`g`在哪被调用？

解答：
```sh
26:	45b1    li a1, 12
```
在地址为26的地方调用了（f(8)+1）的常数，编译器把这个数字优化了。

### 第三个问题：
At what address is the function `printf` located? 

中文翻译：    
`printf`函数的地址位于？

解答：    
```sh
34:	610080e7   jalr	1552(ra) # 640 <printf>
```
注释写了，是`0x640`。

### 第四个问题：
What value is in the register `ra` just after the `jalr` to `printf` in `main`? 

中文翻译：    
在`main`函数中，执行了`jalr`跳转到`printf`之后，`ra`寄存器的值是多少？

解答：    
```sh
34:	610080e7          	jalr 1552(ra) # 640 <printf>
exit(0);
38:	4501                li a0,0
```
`ra`保存的是下一条指令，所以值是`38`，就是`34`+`4`。

### 第五个问题：
Run the following code.
```C
  unsigned int i = 0x00646c72;
  printf("H%x Wo%s", 57616, &i); 
```
What is the output? 

The output depends on that fact that the `RISC-V` is `little-endian`. If the `RISC-V` were instead `big-endian` what would you set `i` to in order to yield the same output? Would you need to change `57616` to a different value?

中文翻译：    
跑一下这个代码。
```C
  unsigned int i = 0x00646c72;
  printf("H%x Wo%s", 57616, &i); 
```
输出会是什么？    
有那样的输出，是因为`RISC-V`是`小端`。    
那如果`RISC-V`是`大端`呢？你应该怎么设置`i`才能让其拥有相同的输出？   
你是否有必要修改`57616`为其他的值？   

解惑：    
我们先了解什么是小端，什么是大端， 
以这个地址为例，`0x00646c72`，小端和大端的存储方式有些不同。
- 小端：72 6c 64 00   
- 大端：00 64 6c 72   

解答：    
首先，输出会是`He110 World`。   
如果是大端的话，只要设置为`0x726c6400`就可以了。    
没必要修改那个常量了，小端大端都一样的那个。

### 第六个问题：
In the following code, what is going to be printed after 'y='? (note: the answer is not a specific value.) Why does this happen?
```C
  printf("x=%d y=%d", 3);
```

中文翻译：    
在下面这个代码，输出了`y=`后，会输出什么数字？不用精确到某个特定数字。
```C
  printf("x=%d y=%d", 3);
```

解答：    
几乎随机的数字，是`a2`寄存器当前的值，很难预测。    
至少我们是很难调整的，除非我们自己改GCC，或者自己写一个奇怪的编译器。

## backtrace (moderate)
这个系统调用看着还挺好用的我觉得，不过不如GDB就是了，那是肯定的，毕竟这是内部的调试工具。   
它的功能的差不多就是打印调用链，不过更麻烦就是了，你得自己用LINUX的`addr2line`命令去查看。    

### 功能预览
当我们在XV6里运行`bttest`，结果大概会是这样：
```sh
backtrace:
0x0000000080002cda
0x0000000080002bb6
0x0000000080002898
```
然后我们就要去打开我们自己的LINUX TERMINAL（如：`zsh`、`bash`、`fish`，或者更简单点说，打开你的`konsole`、`terminal`或`kitty`之类的）。   
运行`addr2line -e kernel/kernel`，然后依次输入那三个地址，你应该会看到类似这样的内容：    
```sh
kernel/sysproc.c:74
kernel/syscall.c:224
kernel/trap.c:85
<ctrl-D>退出
```

### 获取fp值
首先，我们先练习一下写一个内联函数，顺便学习在`C`里使用`汇编`写一些小东西，这些技能是很有用的。
`fp`是存储在`s0`寄存器的，所以我们真正要做的是从`s0`寄存器取值。    

```C
static inline uint64 // inline的意思差不多就是直接插入的意思，性能和define差不多，不过更安全
r_fp()
{
  uint64 x;
  asm volatile("mv %0, s0" : "=r" (x)); // mv x, s0
  return x;
}
```

#### FP是什么？
FP是一个在栈帧里的指针，我不知道它具体被放置在什么位置，但是我觉得读者们只需要先知道它附近是什么就可以了。
- FP - 8：当前栈帧的RA
- FP - 16：上一级栈帧的FP    
例子：
```stack frame
FOO frame
+---------------------------+
|return.addr // fp - 8      |
|to.pr.frame(fp)            |
|saved.registers            |
|local.var                  |
|...                        |
+---------------------------+

BAR frame
+---------------------------+
|return.addr // fp - 8      |
|to.pr.frame(fp) // BAR fp  |
|saved.registers            |
|local.var                  |
|...                        |
+---------------------------+
```

### BACKTRACE函数主要实现
```C
void
backtrace(char* s) // 可以不用有参数，有的话只是更方便调试而已
{
  uint64 curfp = r_fp(); // 获取FP地址
  printf("backtrace: ");
  printf(s);
  printf("\n");

  for(uint64 fp = curfp; fp < PGROUNDUP(curfp); fp = *((uint64*)(fp - 16))) // 执行完成后，返回上级栈帧
    printf("%p\n", *((uint64*)(fp - 8))); // 获取当前RA
}
```

你可能会疑惑，这个`for`循环是怎么停下来的？   
但是很遗憾，我也不是很理解。似乎是跑到`0`的时候就会自己停下来了。   

如果你是好奇语法的话，`*((uint64*)(fp - 8))`是解引用。

### 调试标记
我们写好后，还得放进去系统调用里才行，放进`sysproc.c/sys_sleep`就行了：
```C
uint64
sys_sleep(void)
{
  backtrace("sleep"); // 放这里
  
  int n;
  uint ticks0;

  if(argint(0, &n) < 0)
    return -1;
  acquire(&tickslock);
  ticks0 = ticks;
  while(ticks - ticks0 < n){
    if(myproc()->killed){
      release(&tickslock);
      return -1;
    }
    sleep(&ticks, &tickslock);
  }
  release(&tickslock);
  return 0;
}
```

## alarm (hard)
这个小作业要我们做的是一个有点好用的东西。   
函数原型是这样：`sigalarm(interval, handler)`
我们可以把一个我们自己做的函数发给系统，然后和它说：我要这个函数每几TICKS就跑一次！    
如果想要停止的话，就应该输入`sigalarm(0, 0)`。

### 添加系统调用
和之前的LAB一样，忘了可以去看之前的笔记，我稍微给一些提示，要修改的文件包括但不限于：   
`syscall.c`、`syscall.h`、`sysproc.c`、`user.h`、`usys.pl`。    
需要添加的系统调用为：    
`sys_sigalarm`和`sys_return`。

### 进程新字段
如果我们希望一个函数每几个TICKS执行一次的话，那我们就一定得有一个记录从上次到当前的TICKS数，对吧？    
但是它应该放在计时器中断处理函数那里吗？    
不对，那样的话所有进程都会共享一个计时器，这显然是不合理的。    
所以我们得在进程里添加新字段。    
（＾∀＾●）ﾉｼ    
```C
int alarm_ticks;                  // 设置间隔
uint64 alarm_handler_addr;        // 函数地址（要用函数指针也可以，那个更安全，这个更通用）
uint64 ticks;                     // 进程的总TICKS
uint64 last_ticks;                // 上一次中断的TICKS
struct trapframe *alarm_regs;     // 类似TRAPFRAME，保存状态用的
int alarm_running;                // 状态，正在跑还是没有跑
```

### 系统调用实现
`sysproc.c`：
```C
uint64
sys_sigalarm(void)
{
  int ticks;
  uint64 handler_addr;

  if(argint(0, &ticks) < 0 || argaddr(1, &handler_addr) < 0)
    return -1;

  struct proc* p = myproc();
  p->alarm_ticks = ticks;
  p->alarm_handler_addr = handler_addr;
  p->last_ticks = p->ticks;

  return 0;
}
```

### 上下文
这个我们用TRAPFRAME就好了，没必要弄新的，那样有点麻烦。   
```C
struct trapframe *alarm_regs;     // 类似TRAPFRAME，保存状态用的
```
就是这样而已，然后我们再给它分配一下内存：
```C
// Allocate a trapframe page.
if((p->trapframe = (struct trapframe *)kalloc()) == 0){
  release(&p->lock);
  return 0;
}

// 添加这个๑•̀ㅂ•́)و✧
if((p->alarm_regs = (struct trapframe *)kalloc()) == 0){
  release(&p->lock);
  return 0;
}
```

然后我们还要做两个函数来保存和恢复：    
`trap.c`
```C
void
save_regs(struct proc* p)
{
  *p->alarm_regs = *p->trapframe;
}
```
```C
void restore_regs(struct proc *p)
{
  *p->trapframe = *p->alarm_regs;
}
```
保存就是把当前状态封存起来，恢复就是把封存且还存在的那个东西放到`TRAPFRAME`。

### 计时器中断
读过XV6-BOOK第五章的都知道XV6里有个叫计时器（时钟？还是计数器？具体什么名字我忘了，我在学校才读那玩意）。   
然后呢，XV6也有一个处理计时器中断的东西，好像是每纳秒还是每毫秒中断一次？反正就是很快的，我们基本感觉不到。   
`trap.c/usertrap`：
```C
if(which_dev == 2)
    yield(); // 放弃CPU
```
这是原本的，每次中断它就放弃CPU，我想这应该是为了防止某些进程霸占CPU，所以要系统帮忙放弃。    

然后我们现在得改一下这个，我们得让它对进程的那些TICKS增值，然后跑函数！
```C
if(which_dev == 2) {
    p->ticks++;

    // 如果“间隔”为非0，且该函数没有在以时钟中断的方式运行
    if(p->alarm_ticks != 0 && p->alarm_running == 0) { 

      // 如果上次的“总TICKS”加上“间隔”小于等于“总TICKS”
      if(p->last_ticks + p->alarm_ticks <= p->ticks) {
        p->last_ticks = p->ticks; // 更新LAST_TICKS
        
        save_regs(p); // 保存当前上下文
        p->trapframe->epc = p->alarm_handler_addr;  // 中断后执行该函数
        p->alarm_running = 1;
      }
    }
    yield();
  }
```
#### 执行后返回
`sysproc.c`：
```C
uint64
sys_sigreturn(void)
{
  struct proc* p = myproc();
  restore_regs(p);
  p->alarm_running = 0;

  return 0;
}
```
有的读者可能还是没有那么理解，那我就再解释解释！    
好，首先，读者们可能会想：可以不可以这样呢？我不保存**TRAPFRAME**，我直接开始跑！(｡･∀･)ﾉﾞ    

理论上来说的话，确实可以做到，不过呢，这不是一个好事，因为我们这里存在这一个对`trapframe->epc`的修改，相当于进入了另一个**世界**。    
我们暂且把它们叫做**MAIN世界**和**HANDLER世界**吧。   
当我们更换`EPC`时，相当于从**MAIN**进入了**HANDLER世界**，这时会**开始执行函数**。    
执行完函数后，会跳去哪里呢？    
对，没人知道它会跳去哪里，或者是说，**很难预测**。    
所以我们的方法是，修改世界（函数结尾调用`sigreturn()`），回到**MAIN世界**，继续世界的运作。    

那么返回**MAIN世界**后，修改的东西会不会因此消失呢？    
**部分会**，因为**TRAPFRAME**保存了**SP寄存器**和一些其他寄存器，所以毫无疑问的，**栈（STACK）**上的**变量**可能会不一样。    
**部分不会**，因为**全局变量和静态变量**保存在内存上，内存上的变量（除了栈）不会被**TRAPFRAME**的修改影响到。

啊对了，关于这个系统调用为什么这么奇怪的问题，确实，这无疑是该系统调用**自身的缺陷**。    
毕竟要开发者遵守**隐形规则**的，不遵守就会有预期之外的结果的，自然是一个**不优秀**的系统调用，至少得包装的不容易有预期之外的结果才行。    
但是毕竟我们只是在学习大致上怎么做，所以没必要太纠结于优化这里，最重要的是我们知道了可以怎么做出一个定时执行函数的**PROTOTYPE**。

读者们明白了对吧( ´･･)ﾉ(._.`)。

## 完结撒花 o(*°▽°*)o
好，之后如果有报错就当作是给读者的练习了，当然，如果这个笔记有任何的问题我也会自己改的，除非没看到。

最后编辑时间：2025/6/24
