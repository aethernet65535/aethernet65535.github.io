---
title: XV6-2020: LAB3-PGTBL
published: 2025-06-07
description: "最离谱的守门BOSS"
image: "./lab3.jpg"
tags: ["xv6"]
category: OS
draft: false
---

## 前言
好，这个就是最难的LAB了（我觉得）。如果说LAB1、2是小学水平，那么LAB3至少都是高中水平了，真的难。      
不过，做完之后，你会发现你的水平有了大提升，页表很难，不过也很有趣。     

先提醒一下，如果你还没读`xv6-book`，或是还没看`MIT S6.081`的公开课，我建议你去看一下，页表我学了有差不多1个月吧，很难真的。（也有可能是我太菜了嘤嘤嘤QAQ）      

好，那我们开始吧！

## print a page table (easy)
这个难度是`easy`，事实也确实如此，因为这个是最后的`easy`了，之后就是大boss了。     
如果你有去看我的`GITHUB REPO`，你可能会觉得我的代码很奇怪，我这里说明一下我的代码的作用。   
我写的那些是用来输出`VA`和`PERM`的，没什么用，我DEBUG是完全没用到`VMPRINT`，那些代码可以不抄，毕竟不是作业要求。    
如果你去修改代码调用我的版本，输出会是这样的：
```C
PAGETABLE:0x0000000087f1c000
|-- VA:0x0000000000000000 PTE:0x0000000021fc6001 PA:0x0000000087f18000 PERM:0x1
|-- |-- VA:0x0000000000000000 PTE:0x0000000021fc5c01 PA:0x0000000087f17000 PERM:0x3073
|-- |-- |-- VA:0x0000000000000000 PTE:0x0000000021fc641f PA:0x0000000087f19000 PERM:0x1055
|-- |-- |-- VA:0x0000000000001000 PTE:0x0000000021fc540f PA:0x0000000087f15000 PERM:0x1039
|-- |-- |-- VA:0x0000000000002000 PTE:0x0000000021fc501f PA:0x0000000087f14000 PERM:0x31
|-- VA:0x0000003fc0000000 PTE:0x0000000021fc6c01 PA:0x0000000087f1b000 PERM:0x3073
|-- |-- VA:0x0000003fffe00000 PTE:0x0000000021fc6801 PA:0x0000000087f1a000 PERM:0x2049
|-- |-- |-- VA:0x0000003fffffe000 PTE:0x0000000021fed807 PA:0x0000000087fb6000 PERM:0x2055
|-- |-- |-- VA:0x0000003ffffff000 PTE:0x0000000020001c0b PA:0x0000000080007000 PERM:0x3083
```
我放一下作业要求的输出：
```C
page table 0x0000000087f6e000
..0: pte 0x0000000021fda801 pa 0x0000000087f6a000
.. ..0: pte 0x0000000021fda401 pa 0x0000000087f69000
.. .. ..0: pte 0x0000000021fdac1f pa 0x0000000087f6b000
.. .. ..1: pte 0x0000000021fda00f pa 0x0000000087f68000
.. .. ..2: pte 0x0000000021fd9c1f pa 0x0000000087f67000
..255: pte 0x0000000021fdb401 pa 0x0000000087f6d000
.. ..511: pte 0x0000000021fdb001 pa 0x0000000087f6c000
.. .. ..510: pte 0x0000000021fdd807 pa 0x0000000087f76000
.. .. ..511: pte 0x0000000020001c0b pa 0x0000000080007000
```

好，废话很多了，我们来开始做第一个实验吧。 

### 野生的答案！ 
首先，我们先来看一下`freewalk`函数：
```C
void
freewalk(pagetable_t pagetable)
{
  // there are 2^9 = 512 PTEs in a page table.
  for(int i = 0; i < 512; i++){
    pte_t pte = pagetable[i];
    if((pte & PTE_V) && (pte & (PTE_R|PTE_W|PTE_X)) == 0){
      // this PTE points to a lower-level page table.
      uint64 child = PTE2PA(pte);
      freewalk((pagetable_t)child);
      pagetable[i] = 0;
    } else if(pte & PTE_V){
      panic("freewalk: leaf");
    }
  }
  kfree((void*)pagetable);
}
```
他的作用就是：
1. 遍历512个PTE：
```C
for(int i = 0; i < 512; i++){
    pte_t pte = pagetable[i];
```
2. 处理中间页表：
检查`PTE`是否为`VALID`，并且没有`READ`、`WRITE`、`EXECUTE`权限。如果是的话说明这是中间页表，如果有那三个权限中的任意一个的话，就是叶子节点了。（指向物理内存的页表）
通过`PTE2PA`获得下一个页表的地址然后递归调用：
```C
if((pte & PTE_V) && (pte & (PTE_R|PTE_W|PTE_X)) == 0){
      uint64 child = PTE2PA(pte);
      freewalk((pagetable_t)child);
```
3. 错误处理：
如果发现是叶子页表，那就要直接内核恐慌了（`kernel panic`），因为一般是开发者自行更改页表才会出现这种问题，比起数据遭到预期以为的修改，直接死机是更好的选择。
```C
else if(pte & PTE_V){
      panic("freewalk: leaf");
```
我说的可能有点绕，简单来说就是，如果叶子节点是有效的，那就代表它还是有数据的，我们不应该清空有数据的页表。    
至少这不是`freewalk`需要做的，这是`uvmunmap`做的，感兴趣的可以去`kernel/proc.c`和`kernel/vm.c`看看。
4. 释放当前页表：
```C
kfree((void*)pagetable); // 这个可以执行很多次，有几次取决于你的pagetable总共有多少个 
```
这之后，你的页表们都会被放进`freelist`。

### 野生的再加工！
好，可以开始做实验了。    
首先，去打开`kernel/vm.c`。   
然后，实验代码就是这个：
```C
void
vmprint_ori(pagetable_t pagetable, int level)
{
  for(int i = 0; i < 512; i++){
    pte_t pte = pagetable[i];
    if (!(pte & PTE_V)) continue;

    for (int i = 3; i > level; i--) {
      printf("..");
      if(i-1 > level){
        printf(" ");
      }
    }
    printf("%d: pte %p pa %p\n", i, pte, PTE2PA(pte));
      
    if((pte & (PTE_R|PTE_W|PTE_X)) == 0){
      uint64 child = PTE2PA(pte);
      vmprint_ori((pagetable_t)child, level - 1);
    }
  }
}

void 
vmprint(pagetable_t pagetable)
{
  printf("page table %p\n", pagetable);
  vmprint_ori(pagetable, 2);
}
```

### 调用！
然后我们打开`kernel/exec.c`。   
实验代码如下：
```C
// Commit to the user image.
  oldpagetable = p->pagetable;
  p->pagetable = pagetable;
  p->sz = sz;
  p->trapframe->epc = elf.entry;  // initial program counter = main
  p->trapframe->sp = sp; // initial stack pointer
  proc_freepagetable(oldpagetable, oldsz);

  // 添加这个
  if(p->pid == 1)
    vmprint(p->pagetable);
```
然后去跑跑TEST，应该就可以通过了，那个回答问题的测试你自己`touch`一个然后写答案就可以了。

## a kernel page table per process (hard)
好，这个就是卡我最久的LAB了，是真的难。（2个月左右）

好！我们先来看看这个LAB是要做什么吧！   
首先，XV6的页表现在是怎么样的呢？   

XV6的页表是这样的：
每个用户进程，在用户态运行时，都使用自己的用户态页表。    
但是，一旦进入内核态，就要切换到内核页表，现在这个内核页表是全局的。    

这个实验要我们做的就是，让每个用户进程都有自己的内核页表。    
嘛不过，分两步，这个LAB和下一个关系很大，不可以先去做下一个LAB！    
这个LAB要做的是让XV6从全局内核页表进化为全局+多个副本，并且效果和现在一样。（就是不报错，所有功能正常）   
下一个LAB才是让完善这种进程页表。   

> 这个LAB会改变的：   
> - ❎ 内核页表有各自用户页表的映射
> - ✅ 每个用户进程在内核态将会使用自己的内核页表

好，开始吧！    

### 内核页表副本字段
首先我们要先让我们的进程有一个新的字段。    
和`pagetable`差不多，不过是内核的，所以就叫`kpagetable`吧！   
在`kernel/proc.h`加上新字段：
```C
struct proc {
  struct spinlock lock;

  // p->lock must be held when using these:
  enum procstate state;        // Process state
  struct proc *parent;         // Parent process
  void *chan;                  // If non-zero, sleeping on chan
  int killed;                  // If non-zero, have been killed
  int xstate;                  // Exit status to be returned to parent's wait
  int pid;                     // Process ID

  // these are private to the process, so p->lock need not be held.
  uint64 kstack;               // Virtual address of kernel stack
  uint64 sz;                   // Size of process memory (bytes)
  pagetable_t pagetable;       // User page table
  struct trapframe *trapframe; // data page for trampoline.S
  struct context context;      // swtch() here to run process
  struct file *ofile[NOFILE];  // Open files
  struct inode *cwd;           // Current directory
  char name[16];               // Process name (debugging)
  
  pagetable_t kpagetable;      // 添加这个，以后我们的内核页表就是这个了
};
```

### 创建内核页表副本
然后我们要模仿`kvminit`，这样就能给进程内核页表分东西了。
```C
pagetable_t
kvmmake(int global) 
// 这个参数主要是用来区分全局和副本的
// 副本放CLINT会报错，具体怎么修复我也不知道，目前已知的就是不分配
{
  pagetable_t kpagetable = (pagetable_t) kalloc();
  memset(kpagetable, 0, PGSIZE);

  // uart registers
  mappages(kpagetable, UART0, PGSIZE, UART0, PTE_R | PTE_W);

  // virtio mmio disk interface
  mappages(kpagetable, VIRTIO0, PGSIZE, VIRTIO0, PTE_R | PTE_W);

  if(global == 1)
  // CLINT
  mappages(kpagetable, CLINT, 0x10000, CLINT, PTE_R | PTE_W);

  // PLIC
  mappages(kpagetable, PLIC, 0x400000, PLIC, PTE_R | PTE_W);

  // map kernel text executable and read-only.
  mappages(kpagetable, KERNBASE, (uint64)etext-KERNBASE, KERNBASE, PTE_R | PTE_X);

  // map kernel data and the physical RAM we'll make use of.
  mappages(kpagetable, (uint64)etext, PHYSTOP-(uint64)etext, (uint64)etext, PTE_R | PTE_W);

  // map the trampoline for trap entry/exit to
  // the highest virtual address in the kernel.
  mappages(kpagetable, TRAMPOLINE, PGSIZE, (uint64)trampoline, PTE_R | PTE_X);

  return kpagetable;
}

/*
 * create a direct-map page table for the kernel.
 */
void
kvminit()
{
  kernel_pagetable = kvmmake(1);
}
```
### 将其分配至进程
接下来，我们要把这个副本放进进程里，在`kernel/proc.c`的`allocproc`函数添加以下代码：    
```C
 // An empty user page table.
  p->pagetable = proc_pagetable(p);
  if(p->pagetable == 0){
    freeproc(p);
    release(&p->lock);
    return 0;
  }

  // 添加这个
  p->kpagetable = kvmmake(0); // 正如刚刚所说的，这是副本，所以用参数0
  if(p->kpagetable == 0){
    freeproc(p);
    release(&p->lock);
    return 0;
```

### 将其删除！
因为我们分配了新东西，所以我们要释放进程时也要让系统知道我们要释放新东西！
```C
if(p->pagetable)
    proc_freepagetable(p->pagetable, p->sz);
  p->pagetable = 0;

  // 要释放新东西！
  // 一定要先释放KSTACK！不然会报错！
  if(p->kstack)
    uvmunmap(p->kpagetable, p->kstack, 1, 1);
  p->kstack = 0;
  if(p->kpagetable)
    kvmfree(p->kpagetable); // 这个是新函数，之后你会看到的
  p->kpagetable = 0;
```

### 全部删除！
看到上面的`kvmfree`了对吧？这不是XV6自己的函数，是我们自己实现的函数，具体怎么实现就看这里：    
```C
void
kvmfree(pagetable_t kpagetable)
{
  for(int i = 0; i < 512; i++){
    pte_t pte = kpagetable[i];
    if(pte & PTE_V) 
      kpagetable[i] = 0;
    if((pte & PTE_V) && (pte & (PTE_R|PTE_W|PTE_X)) == 0){
      uint64 child = PTE2PA(pte);
      kvmfree((pagetable_t)child);
    }
  }
  kfree((void*)kpagetable);
}
```
你可能发现了，这不就是`freewalk`吗？    
那确实差不多，但是差了一些，`kvmfree`呢，他是不管`L0 PTE`还有没有指向数据都给你删的，如果是freewalk的话，他是禁止删除指向数据的`L0 PTE`的。
总结一下区别就是：
- freewalk：L0还指向数据？不能删，PANIC！
- kvmfree：L0还指向数据？不过代码让都让我删了，删吧，开发者自己会负责的。

### 内核栈转移
之后，我们看看`kernel/proc.c`里的`procinit`函数，我们会发现，这里有一段分配内核栈的代码：   
```C
// Allocate a page for the process's kernel stack.
// Map it high in memory, followed by an invalid
// guard page.
char *pa = kalloc(); // 分配一页
if(pa == 0) // 错误处理（如果没分配成功）
  panic("kalloc");
uint64 va = KSTACK((int) (p - proc)); // 计算出VA的地址
kvmmap(va, (uint64)pa, PGSIZE, PTE_R | PTE_W); // 把内核栈分配到全局内核页表
p->kstack = va; // 让进程自己知道内核栈的地址
```
我们得把它剪切下来，然后粘贴到`allocproc`，并修改一些代码：   
```C
char *pa = kalloc();
if(pa == 0)
  panic("kalloc");
uint64 va = KSTACK((int) (p - proc));
mappages(p->kpagetable, va, PGSIZE, (uint64)pa, PTE_R | PTE_W);
p->kstack = va;
```
我们修改的代码是：    
```C
kvmmap(va, (uint64)pa, PGSIZE, PTE_R | PTE_W);
mappages(p->kpagetable, va, PGSIZE, (uint64)pa, PTE_R | PTE_W);
```
`kvmmap`版做的是把内核栈分配给全局内核页表。    
但是这个LAB要我们做的就是把全局内核页表的东西搬到或映射到内核页表副本。

所以我们的`mappages`版本做的就是把它分配到进程自己的内核页表副本。


### 小修小补
之后我们还要改一个地方，这个hint没有说，不过是肯定要改的，不然会报错。    
在`kernel/vm.c`的kvmpa函数，修改一些代码：    
```C
uint64
kvmpa(uint64 va)
{
  uint64 off = va % PGSIZE;
  pte_t *pte;
  uint64 pa;
 
  // 从全局页表改为页表副本
  pte = walk(myproc()->kpagetable, va, 0);
  if(pte == 0)
    panic("kvmpa");
  if((*pte & PTE_V) == 0)
    panic("kvmpa");
  pa = PTE2PA(*pte);
  return pa+off;
}
```

### SATP指向全局内核页表？内核页表副本！
如果你有看`kernel/main.c`，你可能会发现，XV6初始化后，就会进入`scheduler`函数找进程，`main.c`我们就像不看了，毕竟这LAB也没有必要看那个（而且我也看不懂（＞人＜；））    

好，那我们就来看`kernel/proc.c`的`scheduler`函数：    
```C
p->state = RUNNING;
c->proc = p;

// 切换至内核页表副本
w_satp(MAKE_SATP(p->kpagetable));
sfence_vma();

// （继续）执行进程
swtch(&c->context, &p->context);

// 进程暂停/结束后 （B点）

// 切换到全局内核页表！
kvminithart();

// ...

// 如果找不到进程跑的话，就先在全局页表观望观望
if(found == 0) {
  kvminithart(); 

  intr_on();
  asm volatile("wfi");
}
```

#### swtch到底是干了什么？
稍微说一下这里比较难理解的一个地方，就是`swtch()`。   
`scheduler()`的`swtch()`先跳去执行那进程。    
执行一段时间后，时间片到了，就会中断，调用`yield()`然后再调用`sched()`，
`sched()`再次调用`swtch()`返回到B点！

## simplify copyin/copyinstr (hard)
好，这里就能给整个LAB3弄出一个惊天大改了！因为我们要真的有一个厉害的内核页表副本了！
> 这个LAB会改变的：   
> - ✅ 内核页表有各自用户页表的映射
> - ✅ 每个用户进程在内核态将会使用自己的内核页表   

就是这样，做好这个之后，XV6就会有一个真·内核页表副本了，不止映射内核，还映射用户空间！    
那话不多说，我们，开始吧~

### 恩赐
XV6很好的给我们准备了`copyin`和`copyinstr`，可以在`kernel/vmcopyin.c`看到，我们先去`kernel/defs.h`那里声明原型，然后直接去`kernel/vm.c`更换就行了：
```C
// Copy from user to kernel.
// Copy len bytes to dst from virtual address srcva in a given page table.
// Return 0 on success, -1 on error.
int
copyin(pagetable_t pagetable, char *dst, uint64 srcva, uint64 len)
{
  // 之前的代码通通删掉！！注释也行
  return copyin_new(pagetable, dst, srcva, len);
}

// Copy a null-terminated string from user to kernel.
// Copy bytes to dst from virtual address srcva in a given page table,
// until a '\0', or max.
// Return 0 on success, -1 on error.
int
copyinstr(pagetable_t pagetable, char *dst, uint64 srcva, uint64 max)
{
  // 一样，通通删掉
  return copyinstr_new(pagetable, dst, srcva, max);
}
```
### 内核和用户同步！（修改底层代码！）
在我们每次修改用户内存时，我们就让内核页表副本也一同修改就行了，这样不就可以同步了嘛（(￣y▽,￣)╭ ）：   

第一个，是我们分配内存时，也要给自己的内核分配一下！    
所以我们得去`kernel/vm.c`修改一些东西：
```C
uint64
uvmalloc(pagetable_t pagetable, pagetable_t kpagetable, uint64 oldsz, uint64 newsz)
{
  char *mem;
  uint64 a;

  if(newsz < oldsz)
    return oldsz;

  oldsz = PGROUNDUP(oldsz);
  for(a = oldsz; a < newsz; a += PGSIZE){
    mem = kalloc();
    if(mem == 0){
      goto error;
    }
    memset(mem, 0, PGSIZE);
    if(mappages(pagetable, a, PGSIZE, (uint64)mem, PTE_W|PTE_X|PTE_R|PTE_U) != 0||
       mappages(kpagetable, a, PGSIZE, (uint64)mem, PTE_W|PTE_X|PTE_R)){
      kfree(mem);
    error:
      uvmdealloc(pagetable, a, oldsz);
      uvmdealloc_nofree(kpagetable, a, oldsz);
      return 0;
    }
  }
  return newsz;
}
```

嗯，但是我们可能要`fork`对吧？这时候就也要把自己的内核页表`fork`过去啦！
```C
int
uvmcopy(pagetable_t old, pagetable_t new, pagetable_t kpagetable, uint64 sz)
{
  pte_t *pte;
  uint64 pa, i;
  uint flags;
  char *mem;

  for(i = 0; i < sz; i += PGSIZE){
    if((pte = walk(old, i, 0)) == 0)
      panic("uvmcopy: pte should exist");
    if((*pte & PTE_V) == 0)
      panic("uvmcopy: page not present");
    pa = PTE2PA(*pte);
    flags = PTE_FLAGS(*pte);
    if((mem = kalloc()) == 0)
      goto err;
    memmove(mem, (char*)pa, PGSIZE);
    if(mappages(new, i, PGSIZE, (uint64)mem, flags) != 0 ||
       mappages(kpagetable, i, PGSIZE, (uint64)mem, flags & ~PTE_U) != 0){
      kfree(mem);
      goto err;
    }
  }
  return 0;

 err:
  uvmunmap(new, 0, i / PGSIZE, 1);
  uvmunmap(kpagetable, 0, i / PGSIZE, 1);
  return -1;
}
```

下一个，读者们用过`htop`吗？如果用过的话应该知道我们有个进程叫`init`吧？`pid 01`的那个。   
没错，XV6也有`init`进程，但是他的创建方法比较不一样，但是我们也得改！毕竟要改的全嘛！
```C
void
uvminit(pagetable_t pagetable, pagetable_t kpagetable, uchar *src, uint sz)
{
  char *mem;

  if(sz >= PGSIZE)
    panic("inituvm: more than a page");
  mem = kalloc();
  memset(mem, 0, PGSIZE);
  mappages(pagetable, 0, PGSIZE, (uint64)mem, PTE_W|PTE_R|PTE_X|PTE_U);
  mappages(kpagetable, 0, PGSIZE, (uint64)mem, PTE_W|PTE_R|PTE_X);
  memmove(mem, src, sz);
}
```
> 注：不要忘了`kpagetable`那里不可以有`PTE_U`哦！ヾ(•ω•`)o

<br>

然后还有几个呢，就是我们有时候不是要扩容或缩小内存嘛？所以那部分代码我们也得改！    
这些属于小修小补，我就不怎么细说了！        
在`kernel/proc.c`修改：
```C
// userinit
uvminit(p->pagetable, p->kpagetable, initcode, sizeof(initcode));

// growproc
if((sz = uvmalloc(p->pagetable, p->kpagetable, sz, sz + n)) == 0)

// fork
if(uvmcopy(p->pagetable, np->pagetable, np->kpagetable, p->sz) < 0)
```
下面这个比较重要，是要在我们缩小内存时同步：
```C
//growproc
else if(n < 0){
  uint sz2 = sz;
  sz = uvmdealloc(p->pagetable, sz, sz + n);
  uvmdealloc_nofree(p->kpagetable, sz2, sz2 + n);
}
```

### 寻找
XV6的`walk`有一些问题，就是它只能用来找用户的VA，所以我们要稍微改一下！   
就是删一个判断而已，很简单的！    
在`kernel/vm.c`：
```C
uint64
kvmaddr(pagetable_t pagetable, uint64 va)
{
  pte_t *pte;
  uint64 pa;

  if(va >= MAXVA)
    return 0;

  pte = walk(pagetable, va, 0);
  if(pte == 0)
    return 0;
  if((*pte & PTE_V) == 0)
    return 0;
  pa = PTE2PA(*pte);
  return pa;
}
```

### 删除？不删除！
`uvmdealloc`也有一些问题，就是它默认会清理我们所指向的内存，但是内核页表当然不能这样做啦，不然一启动就直接把全局内核页表的扬了！o((>ω< ))o    
这个也超级简单的，把`1`变成`0`而已！    
在`kernel/vm.c`：
```C
uint64
uvmdealloc_nofree(pagetable_t pagetable, uint64 oldsz, uint64 newsz)
{
  if(newsz >= oldsz)
    return oldsz;

  if(PGROUNDUP(newsz) < PGROUNDUP(oldsz)){
    int npages = (PGROUNDUP(oldsz) - PGROUNDUP(newsz)) / PGSIZE;
    uvmunmap(pagetable, PGROUNDUP(newsz), npages, 0);
  }

  return newsz;
}
```

### 限制生长！
现在的话，要给用户进程不能无限扩容了，不然他可能会覆盖到内核页表。    
那我们要怎么做呢？没错，就是找到内核页表最低的地方，也就是`PLIC`！    
然后就不让他长到那里！        
为什么不是`CLINT`呢？因为内核副本不映射呀！(。・∀・)ノ    

修改`kernel/sysproc.c`：
```C
uint64
sys_sbrk(void)
{
  int addr;
  int n;

  if(argint(0, &n) < 0)
    return -1;
  addr = myproc()->sz;
  if(PGROUNDUP(addr+n) >= PLIC)
    return -1;
  if(growproc(n) < 0)
    return -1;
  return addr;
}
```

### 大改！
`kernel/exec.c`主要是加载程序用的，比如我输入`exec(echo, echo hi)`（差不多这样，可能错了，但是理解就行了！），那它就会就会进来这里加载`echo`程序并把参数也放进去。不过我们没必要了解那么多，只要这里主要是更换页表然后同步内存就行了，很简单对吧！ヾ(≧▽≦*)o

这段的作用是：
- 创建新的内核页表
- 把内核栈从旧页表中导出
- 把内核栈放进新页表
```C
pagetable_t pagetable = 0, oldpagetable;
struct proc *p = myproc();

// 加这段
pagetable_t old_kpagetable = p->kpagetable;
pagetable_t new_kpagetable = kvmmake(0);
uint64 kstack_pa = kvmaddr(old_kpagetable, p->kstack);
mappages(new_kpagetable, p->kstack, PGSIZE, (uint64)kstack_pa, PTE_R|PTE_W);

begin_op();
```

下面这些的话，就是同步而已，而且原型都变了，不改就肯定报错了呢！     

作用就是：
- 把系统对用户页表做的东西同步至进程自己的内核页表    
```C
uint64 sz1;

// 修改这行
if((sz1 = uvmalloc(pagetable, new_kpagetable, sz, ph.vaddr + ph.memsz)) == 0)
  goto bad;
```
```C
uint64 sz1;

// 这行也改！
if((sz1 = uvmalloc(pagetable, new_kpagetable, sz, sz + 2*PGSIZE)) == 0)
  goto bad;
```

之前的话，没有内核页表副本嘛，所以exec当然就不用切换到这里，但是现在我们有了，所以就得主动切换到内核页表副本！    

作用就是：
- 当前进程的指向从旧内核页表转向新内核页表
- `SATP`指向新内核页表
- 刷新`TLB`
- 释放旧内核页表（不然浪费内存）
```C
p->trapframe->sp = sp; // initial stack pointer
proc_freepagetable(oldpagetable, oldsz);

// 添加这段！
p->kpagetable = new_kpagetable;
w_satp(MAKE_SATP(p->kpagetable));
sfence_vma();
kvmfree(old_kpagetable);

if(p->pid == 1)
  vmprint(p->pagetable);
```

### 嗯？怎么报错？
报错了吗？那确实可能是我这笔记不够仔细呢，不过如果你好好跟着这个笔记走的话，是不太可能有什么大报错的，基本都是一些语法的报错，比如我们刚刚动了很多函数对吧，你只要去改一些参数就可以了，这些就当作是练习吧，不难的！

### 完结撒花
这个真的是最难的一个LAB了，是不是之一不知道，不过很难，博主用了至少一个月来理解页表呀！   
不过这LAB让我学到的东西也超级多的，可以说是最好的LAB了！

## 常见疑问
Q：这个实验之后，我们在内核态和用户态用的分别是什么页表呢？   
A：我调试了下，在`usertrap`时，使用的是`kpagetable`。用户态理论上是`pagetable`，但是我调试不出。具体为什么我会说理论上是，主要是这两段代码：    
`kernel/trampoline.S:88`
```C
userret:
  # userret(TRAPFRAME, pagetable)
  # switch from kernel to user.
  # usertrapret() calls here.
  # a0: TRAPFRAME, in user page table.
  # a1: user page table, for satp.

  # switch to the user page table.
  csrw satp, a1
  sfence.vma zero, zero
```
`kernel/trap.c:usertrapret`
```C
// tell trampoline.S the user page table to switch to.
uint64 satp = MAKE_SATP(p->pagetable);

// jump to trampoline.S at the top of memory, which 
// switches to the user page table, restores user registers,
// and switches to user mode with sret.
uint64 fn = TRAMPOLINE + (userret - trampoline);
((void (*)(uint64,uint64))fn)(TRAPFRAME, satp);
```

Q：为什么蹦床会跳进`kpagetable`，而不是`kernel_pagetable`？   
A：因为`trampoline`用的内核页表似乎是`scheduler`设置的内核页表。
```C
// set up trapframe values that uservec will need when
// the process next re-enters the kernel.
p->trapframe->kernel_satp = r_satp();         // kernel page table
p->trapframe->kernel_sp = p->kstack + PGSIZE; // process's kernel stack
p->trapframe->kernel_trap = (uint64)usertrap;
p->trapframe->kernel_hartid = r_tp();         // hartid for cpuid()
```

## 扯淡 （最没用的小篇章，不建议看）
就是随便说说的东西而已，和笔记有些关系，不过无关的也多，读者无聊的话可以看，不过干货不多就是了。    
（；´д｀）ゞ

更新：2025/6/17 PM04:00   
今天学校几乎没老师来，学校好像60多位，至少30个没来，所以我就在班上读`XV6-BOOK`，然后我刚好重新读了CHAPTER-4，就看到了陷阱相关的知识。
现在我回到家了，我再次用`gdb`调试，这次专门给`usertrapret`设置断点，然后我发现，第一次拦截时，SATP指向一个既不是全局内核页表也不是内核页表副本的地方，我不知道是哪里。但是第二次拦截时，就是指向内核页表副本了。

我觉得有点奇怪，不过也正常，毕竟我还在学习XV6，太难了这一课，虽然作业是做好了，但是我不觉得我理解了页表什么时候切换。

有什么新发现我会继续更新，这篇说不定到我做完XV6所有LABS了都还会更新呢，毕竟太难了( ´･･)ﾉ(._.`)

更新：2025/6/17 PM09:05   
似乎知道为什么第一次是奇怪的SATP了，估计是因为我断点在了开头，现在发现只要跑多几行就可以了，好神奇！

不过我现在很累了呢，眼睛已经要关起来了，毕竟学校弄了个笨活动，我不喜欢，要多人合作，不能自己搞，自己搞比较容易...   
算了，反正我做好了，睡觉（＞人＜；）！

更新：2025/6/18 AM08:28   
发现了个新东西，如果电脑性能不好的话，`echo hi`会被`scheduler`断点停下，但是如果好的话就不会。这似乎是因为，时间片还没用完。    
嘛不过，`usertrapret`还是一定会停下的。

上次编辑日期：2025/6/15   
最后编辑时间：2025/6/25
