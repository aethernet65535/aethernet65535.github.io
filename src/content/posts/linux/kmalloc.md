---
title: "小对象分配与释放：kmalloc()/kfree()"
published: 2025-10-24
description: "开始学习Linux内存管理吧"
image: "./kmalloc.png"
tags: ["Memory Management", "Linux", "Read Code"]
category: Kernel
draft: false
---

# 前言
注意：这是博主在学习过程中的理解笔记，可能包含简化或未深入探讨的部分。随着对内核理解的加深，可能会持续更新更准确的内容！

好久没写博客了，回来写写练练手。
提醒：由于博客比较乱，推荐读者用另一台显示器/设备准备完整的源代码搭配博客食用。
可以用这个网站：https://elixir.bootlin.com/linux/v5.10.245/source/mm/

## 状态
现在在学习的是Linux的内存管理，因为我觉得内存管理应该是操作系统中一个很重要的东西，毕竟计算机最重要的两个硬件就是CPU和内存嘛，虽然文件系统也很重要就是了，不过我觉得有点太难了，所以先不学。
博主现在水平...还算是个刚入门不久的新手吧，刚学变成9个月。

## 内核版本
啊对了，我正在学的是Linux 5.10.245的版本，要问为什么不是最新版的话，主要是因为最新版更容易有改动，而且就是，我感觉5.10比较好读，而且不算太老，好多安卓系统都还是5.10.x的内核呢。

这篇我们先简单的看看`kmalloc()`和`kfree()`。

# 调用链
我们先大致上看一下调用链（不完整的），以此理解大概有多少个步骤：
include/linux/slab.h, line 538
```
kmalloc()
|-- kmalloc_large() [size > 8192B(8KB)]   /* 一般是页级的 */
|   |-- kmalloc_order_trace()
|       |-- kmalloc_order()               /* 从Buddy分配一页并转换为地址返回 */
|           |-- alloc_pages()             /* 分配页 */
|           |-- page_address()            /* 把页转换为虚拟地址 */
|
|-- __kmalloc() [else]    /* 一般是对象级的 */
    |-- kmalloc_slab()    /* 找到应该分配多大内存的对象 */
    |-- slab_alloc()      /* 从Slab分配该对象地址 */
```
还有就是，CONFIG_SLOB的博主选择性忽略了，毕竟一般上我们用的机器都是SLUB的。

## 为什么会有两个分支？
其实原因很简单，一个负责分配大的，一个负责分配小的。
比如这样，我们写过许多结构体对吧？当我们分配时，是不是这样做的？
```c
malloc(sizeof(struct foobar));
```

### SLAB
但是有一个问题，一般而言，我们的结构体能有多大呢？可能甚至10KB都没有，可能就几个字节而已呢。
但是，MMU管理的最小单位是4KB（现在安卓和iOS是16KB），这样不是很浪费吗？只用几个字节却要用那么大的页。
所以聪明的Linux内核开发就想到了，可以把所有申请来的结构体都存在一页，而且他们还能隔离哦，超级厉害！

本来可能是这样：[struct foobar 16B] -> [free 4080B]
但是开发者们优化后，就会变成这样：[struct foobar 16B] -> [struct two 10B] -> [struct block 32B] -> [free...] 
这个，就叫做SLAB！

### BUDDY
而`kmalloc_large()`就很好理解啦，就是分配一页一页的内存，因为这样管理大一些的内存更高效呢。

# `kmalloc()`源代码
好，现在来看代码吧，代码会让我们更好的理解！
同样的，我也会选择性忽略SLOB的实现。

## kmalloc
```c
static __always_inline void *kmalloc(size_t size, gfp_t flags)
{
	if (__builtin_constant_p(size)) { /* 如果size是常量 */

        /* 这里的值在SLUB配置是8KB */
		if (size > KMALLOC_MAX_CACHE_SIZE) 
			return kmalloc_large(size, flags);
			
	}
	return __kmalloc(size, flags);
}
```
这个代码没多难，首先检测值是否是编译期间的常量，我们平时用的`sizeof()`就是其中一个。
大于8KB的话就会走`kmalloc_large(size, flags)`，是页级的分配，因为8KB已经是两页的大小了，不是什么小体量。
小体量的话会走`__kmalloc(size, flags)`，分配的是一个SLAB的对象，可能比你预期的大小要来的大，但绝对不会更小。

### 知识补充点
```c
__builtin_constant_p(size)
```
这个判断是，输入是否是编译期间的常量，可以提升几纳秒的速度（已经很好了！！）。
那什么是编译期间的常量呢？

编译时常量：
```c
#define SIZE 1024
static const int size = 1023+1;
1024+255
sizeof(struct foobar)
```
非编译时常量：
```c
int size = 1023+1;
int size = rdm();
int size = usr_input + 1024;
```

具体怎么优化呢？
差不多是这样：
本来我们内核模块写的是这样：
```c
char *addr = kmalloc(64, GFP_KERNEL);
```
由于`64`是常量，所以编译器就会这样优化我们的代码：
```c
char *addr = __kmalloc(64, GFP_KERNEL);
```
几纳秒的提升速度对一次分配来说可能没有什么区别，但是对频繁分配还是很有益的，可以为用户节省不少时间呢。

## __kmalloc
由于我们一般对`kmalloc()`的应用在小内存分配，所以就先看看对应的SLAB分配版本吧！

```c
void *__kmalloc(size_t size, gfp_t flags)
{
	struct kmem_cache *s;
	void *ret;
	
	if (unlikely(size > KMALLOC_MAX_CACHE_SIZE))
		return kmalloc_large(size, flags);
```
因为我们大概率是从kmalloc进来的，所以这个条件大部分情况下并不为真。

```c
	s = kmalloc_slab(size, flags);
```
这个函数是去找我们应该用什么大小的内存，比如我希望获得13字节的内存，但是内核觉得13这数字太邪门了，于是就给我分配了16字节的内存，比较吉利。
当然和信仰没关系，只是16更好对齐而已（笑）。

```c
	if (unlikely(ZERO_OR_NULL_PTR(s)))
		return s;
```
有时候，我们会输入`kmalloc(foobar, GFP_KERNEL)`，`foobar`可能为`0`，但是其实这是没问题的，内核允许发生这样的行为，所以只会取消分配内存，并不会报错，就像`kfree(NULL)`不会出问题一样。
注：申请`0`内存的话，返回为`((void *)16)`，非法或`kmalloc_slab()`函数失败返回`NULL`。

```c
	ret = slab_alloc(s, flags, _RET_IP_);
```
刚刚的`kmalloc_slab()`找到了要给调用放分配多少内存，这个函数做的就是分配内存的工作。

```c
	trace_kmalloc(_RET_IP_, ret, size, s->size, flags);

	ret = kasan_kmalloc(s, ret, size, flags);

	return ret;
}
```
这些是调试代码，kasan是Linux内核的内存调试工具我记得，不过博主现在还太笨了，要是对调试感兴趣的话那基本每个函数的学习时间都要上几倍，所以懒惰的博主就选择性略过了，读者们可以去看看更厉害的大佬发的笔记。


### 知识补充点
```c
EXPORT_SYMBOL(__kmalloc);
```
这个简单来说就是，如果有的话，内核模块就能直接调用了，如果没有的话内核模块就只能间接调用。
类似开放API吧，开放给内核模块使用。有另一个GPL版本的，那种是之开放给GPL协议的模块使用。

## kmalloc_slab
```c
struct kmem_cache *kmalloc_slab(size_t size, gfp_t flags)
{
	unsigned int index;

    /* 大概是内核开发者们深思熟虑后的一个值吧... */
	if (size <= 192) {
		if (!size)
			return ZERO_SIZE_PTR;

		index = size_index[size_index_elem(size)];
```
这里我们直接进入`size_index`这一个数组吧，毕竟不大。
```c
static u8 size_index[24] __ro_after_init = {
	3,	/* 8 */
	4,	/* 16 */
	5,	/* 24 */
	5,	/* 32 */
	6,	/* 40 */
	6,	/* 48 */
	6,	/* 56 */
	6,	/* 64 */
	1,	/* 72 */
	1,	/* 80 */
	1,	/* 88 */
	1,	/* 96 */
	7,	/* 104 */
	7,	/* 112 */
	7,	/* 120 */
	7,	/* 128 */
	2,	/* 136 */
	2,	/* 144 */
	2,	/* 152 */
	2,	/* 160 */
	2,	/* 168 */
	2,	/* 176 */
	2,	/* 184 */
	2	/* 192 */
};
```
这里其实并不难理解，逻辑大概是这样，如果传进来的是8字节，那么就会去3的下标，如果传进来的是16，就会去4的下标。
但是，为什么192字节的下标是2呢？是不是很奇怪呢？这个就要配合另一个函数看了呢（悲，嵌套真多呀）。

不过在那之前，我们得先知道，怎么得到这些索引。
```c
static inline unsigned int size_index_elem(unsigned int bytes)
{
	return (bytes - 1) / 8;
}
```
就是这样而已，非常简单，减1然后再除8。好那我们继续吧！

```c
const struct kmalloc_info_struct kmalloc_info[] __initconst = {
	INIT_KMALLOC_INFO(0, 0),               /* 0 */
	INIT_KMALLOC_INFO(96, 96),             /* 1 */
	INIT_KMALLOC_INFO(192, 192),           /* 2 */
	INIT_KMALLOC_INFO(8, 8),               /* 3 */
	INIT_KMALLOC_INFO(16, 16),             /* 4 */
	INIT_KMALLOC_INFO(32, 32),             /* 5 */
	INIT_KMALLOC_INFO(64, 64),             /* 6 */
	INIT_KMALLOC_INFO(128, 128),           /* 7 */
	INIT_KMALLOC_INFO(256, 256),           /* 8 */
	INIT_KMALLOC_INFO(512, 512),           /* 9 */
	INIT_KMALLOC_INFO(1024, 1k),           /* 10 */
	INIT_KMALLOC_INFO(2048, 2k),           /* 11 */
	INIT_KMALLOC_INFO(4096, 4k),           /* 12 */
	INIT_KMALLOC_INFO(8192, 8k),           /* 13 */
	INIT_KMALLOC_INFO(16384, 16k),         /* 14 */
	INIT_KMALLOC_INFO(32768, 32k),         /* 15 */
	INIT_KMALLOC_INFO(65536, 64k),         /* 16 */
	INIT_KMALLOC_INFO(131072, 128k),       /* 17 */
	INIT_KMALLOC_INFO(262144, 256k),       /* 18 */
	INIT_KMALLOC_INFO(524288, 512k),       /* 19 */
	INIT_KMALLOC_INFO(1048576, 1M),        /* 20 */
	INIT_KMALLOC_INFO(2097152, 2M),        /* 21 */
	INIT_KMALLOC_INFO(4194304, 4M),        /* 22 */
	INIT_KMALLOC_INFO(8388608, 8M),        /* 23 */
	INIT_KMALLOC_INFO(16777216, 16M),      /* 24 */
	INIT_KMALLOC_INFO(33554432, 32M),      /* 25 */
	INIT_KMALLOC_INFO(67108864, 64M)       /* 26 */
};
```
也就是说，如果传进来的是8字节，那么就会返回说“给调用方分8字节吧！”。
如果传进来的是77字节，我们来算一下，`(77 - 1) = 76, 76 / 8 = 9.5 == 9`，那么就是第9个！
我们看看是哪个，嗯，是这个：
```c
	1,	/* 80 */
    INIT_KMALLOC_INFO(96, 96),             /* 1 */
```
如果我们申请了77字节，系统就会给我们升级成96字节，原因我们先不用太在意，博主想可能是因为这个位比较有性价比之类的。
这里是通过`size_inde`定位到`kmalloc_info`的位置。

```c
	} else {
        /* 怎么想都不会触发这个吧（笑）*/
		if (WARN_ON_ONCE(size > KMALLOC_MAX_CACHE_SIZE))
			return NULL;
		index = fls(size - 1);
	}
```
`fls()`的话，是找到`size-1`最高的1位在第几位。
比如`size`是16，-1后就是15，也就是0000000000001111，最高的1位就是第四位，那我们看看4是多少：
```c
	INIT_KMALLOC_INFO(16, 16),             /* 4 */
```
我们可以发现，这里就不使用`size_index`了，而是直接定位到`kmalloc_info`的位置。


```c
	return kmalloc_caches[kmalloc_type(flags)][index];
}
```
这里就是返回“要哪里的内存+要多少内存”，类似一个标签，方便`slab_alloc()`分配。
感兴趣的可以先继续看下去，不感兴趣的可以直接不看这个函数了。

```c
static __always_inline enum kmalloc_cache_type kmalloc_type(gfp_t flags)
{
#ifdef CONFIG_ZONE_DMA
	/*
	 * The most common case is KMALLOC_NORMAL, so test for it
	 * with a single branch for both flags.
	 */
	if (likely((flags & (__GFP_DMA | __GFP_RECLAIMABLE)) == 0))
		return KMALLOC_NORMAL;
```
如果调用方所传入的`flags`不包含`__GFP_DMA`和`__GFP_RECLAIMABLE`，那么就直接返回`KMALLOC_NORMAL`。
可能是因为Linux认为一般上都用不到这两个，`GFP_KERNEL`也确实都没有这两个。

```c
	/*
	 * At least one of the flags has to be set. If both are, __GFP_DMA
	 * is more important.
	 */
	return flags & __GFP_DMA ? KMALLOC_DMA : KMALLOC_RECLAIM;
```
如果是开启了DMA区的配置，那么就会查看`flags`是否包含`__GFP_DMA`。
如果包含，就会返回`KMALLOC_DMA`，这样之后分配时系统就知道我们要把内存分配给DMA，以此更好的对这次分配做优化。
如果不包含，那就返回`KMALLOC_RECLAIM`，也就是可回收内存。

```c
#else
	return flags & __GFP_RECLAIMABLE ? KMALLOC_RECLAIM : KMALLOC_NORMAL;
#endif
}
```
不开DMA区的话，那就会查看我们的`flags`是否包含了`__GFP_RECLAIMABLE`。
如果有的话，就会返回`KMALLOC_RECLAIM`。
如果没有的话，就直接返回`KMALLOC_NORMAL`了，和DMA的区别就是少了个`KMALLOC_DMA`而已。

## slab_alloc
```c
static __always_inline void *slab_alloc(struct kmem_cache *s,
		gfp_t gfpflags, unsigned long addr)
{
	return slab_alloc_node(s, gfpflags, NUMA_NO_NODE, addr);
}
```
这个我们直接进去就好了，关于`NUMA_NO_NODE`的话，这个的意思是，哪个NODE好哪个来，让系统看着办。
不过NUMA一般是服务器的，我们的机器一般是UMA（至少博主的古老设备是）。

```c
static __always_inline void *slab_alloc_node(struct kmem_cache *s,
		gfp_t gfpflags, int node, unsigned long addr)
{
	void *object;
	struct kmem_cache_cpu *c;
	struct page *page;
	unsigned long tid;
	struct obj_cgroup *objcg = NULL;

	s = slab_pre_alloc_hook(s, &objcg, 1, gfpflags);
	if (!s)
		return NULL;
```
这个`slab_pre_alloc_hook()`主要是调试用的函数，博主太笨了，先跳过。

```c
redo:
	do {
		tid = this_cpu_read(s->cpu_slab->tid);
		c = raw_cpu_ptr(s->cpu_slab);
	} while (IS_ENABLED(CONFIG_PREEMPTION) &&
		 unlikely(tid != READ_ONCE(c->tid)));
```
这个是一个乐观锁，乐观锁就是，先做事情，如果错了就重来，也就是默认是对的。
`tid`是这次的SLAB分配器执行事务的事务ID。

`s->cpu_slab`是per-CPU变量，但是也是所有cpu共享的，读取时不需要同步，因为CPU不会修改其他CPU的这个变量。
`c->tid`是共享变量，可能被其他CPU同时修改。

`IS_ENABLED(CONFIG_PREEMPTION)`是说这个操作系统是否是抢占式操作系统，如果读者不知道的话，就默认是吧，因为我们的机器一般都是抢占式系统的，不过要是读者正在学单片机什么的，最好了解下自己机器的系统是什么的哦！（学单片机就认真点！！）

`unlikely(tid != READ_ONCE(c->tid)))`，这里做的是，这个CPU的`tid`是否和全局的`tid`一致，不一致的话就代表现在的CPU指针执行的地址内部可能有几个东西是不安全的，所以得重新来。

可能有点难以理解...差不多的意思就是：
"在我工作的时候，如果有人动过我的工具箱（tid变化了），我就得重新确认一下工作环境，避免把书放错位置！"

那可能被影响的工作环境是什么呢？博主知道的其中一个是这个：
```c
struct kmem_cache_cpu {
	void **freelist;	/* Pointer to next available object */
	unsigned long tid;	/* Globally unique transaction id */
	struct page *page;	/* The slab from which we are allocating */
#ifdef CONFIG_SLUB_CPU_PARTIAL
	struct page *partial;	/* Partially allocated frozen slabs */
#endif
#ifdef CONFIG_SLUB_STATS
	unsigned stat[NR_SLUB_STAT_ITEMS];
#endif
};
```
读者们可能不知道这个是什么，博主简单的说一下，这个就类似一个BUDDY FREELIST，只不过是SLUB版本的。
读者们可以这样理解，我们要分配给用户4KB的页，所以就准备了很多的4KB的页，都是每人用的，那么这个放着空闲页的盒子就叫做FREELIST。
SLAB的比较特别，因为SLAB是多多东西挤在一个页里的，所以`kmem_cache_cpu`就只会缓存一页，当然SLAB也是可以有两页的，不过那种自然就不适合在CPU上缓存嘛，所以就不在这个结构体啦。

我来给读者们说一下各个字段的含义：
- `void **freelist`： 这个就是指向下一个空闲的对象地址，之后我们还会看到新的东西，叫做FREE POINTER，它和这个很像。
- `unsigned long tid`： 这个刚刚说啦，就是让自己知道有没有别人动过我们工作环境的事务号。
- `struct page *page`： 这个就是那个挤一堆对象的页。
- `struct page *partial`： 这个是备用的，指向一个`page`链表，博主推测是满了后就可以快速换成另一个可用`page`。

```c
	barrier();
```
这个是给编译器提醒的，就是说，`barrier()`之前的代码，不能跑到`barrier()`之后。
同样的`barrier()`之后的代码，也不能跑到`barrier()`之前执行。
因为编译器和CPU都喜欢优化，所以可能会乱序一些代码，怎么开心怎么来，所以我们就用这个限制。

```c
	object = c->freelist;
	page = c->page;
```
刚刚说了，`freelist`就是指向第一个空闲对象的指针，再次提醒，他也可以叫FREE POINTER哦！

```c
	if (unlikely(!object || !page || !node_match(page, node))) {
		object = __slab_alloc(s, gfpflags, node, addr, c);
```
`node_match(page, node)`这个虽然几乎不可能触发，不过还是和读者们说一下，这个函数的作用是，查看我们获取到的`page`地址是否为`node`的本地地址内。
为什么几乎不可能触发呢？第一，我们是UMA机器。第二，我们已经和这个函数说了，哪个`node`开心就用哪个，也就是挑选最为合适的`node`。

然后`__slab_alloc`是失败的快速分配路径，也就是现在这个满了的意思，这个`page`/SLAB已经没有地方存放对象了。
这个函数大致上会这样做：
1. 先看当前CPU的`partial`链表有没有可用的`page`/SLAB。
2. 如果没有，去对应NUMA节点的`partial`链表找。
3. 如果还没有，那就只能从BUDDY分配全新的页了。

```c
	} else {
		void *next_object = get_freepointer_safe(s, object);                                                                                                                                                  
```
我们拿走了这个对象后，下一个空闲的对象在哪，函数将返回下一个空闲对象的地址。

```c
		if (unlikely(!this_cpu_cmpxchg_double(
				s->cpu_slab->freelist, s->cpu_slab->tid,
				object, tid,
				next_object, next_tid(tid)))) {

			note_cmpxchg_failure("slab_alloc", s, tid); /* 记录下来失败了 */
			goto redo;
		}
```
和刚刚的乐观锁差不多，`this_cpu_cmpxchg_double()`期待，到达这行时：
```c
s->cpu_slab->freelist == object
s->cpu_slab->tid == tid
```
如果确实是这样，那么就会执行：
```c
s->cpu_slab->frelist = next_object;
s->cpu_slab->tid = next_tid(tid);
```

```c
		prefetch_freepointer(s, next_object);
		stat(s, ALLOC_FASTPATH);
	}
```
`prefetch_freepointer()`： Linux觉得，我们不久后就会访问这个地址，也就是再申请多一个同类型的对象，所以就先预热一下，让等下可以直接缓存命中。

```c
	maybe_wipe_obj_freeptr(s, object); 

	if (unlikely(slab_want_init_on_alloc(gfpflags, s)) && object)
		memset(object, 0, s->object_size);

	slab_post_alloc_hook(s, objcg, gfpflags, 1, &object); /* 调试的，不管了 */

	return object; /* 大功告成！*/
}
```
`maybe_wipe_obj_freeptr()`： 这个就是在我们把对象分配出去之前，把`next_object`那里清理一下，以免调用方跑去访问那里结果不小心Kernel Panic。
`if (unlikely(slab_want_init_on_alloc(gfpflags, s)) && object)`： 这个放`unlikely`我还挺惊讶的，因为如果我们使用`kzalloc()`的话，这里就是负责清零的地方，可能是因为Linux认为开发者一般不会选择清零这种昂贵操作，所以就`unlikely`吧...

## kmalloc_large
好，现在来看一下`kmalloc_large()`，差点忘了这个函数。
```c
static __always_inline void *kmalloc_large(size_t size, gfp_t flags)
{
 unsigned int order = get_order(size);
 return kmalloc_order_trace(size, flags, order);
}
```
有trace的基本就是调试的意思，不过这里不能跳过了，跳了就没东西看了。

```c
#ifdef CONFIG_TRACING
void *kmalloc_order_trace(size_t size, gfp_t flags, unsigned int order)
{
 void *ret = kmalloc_order(size, flags, order);
 trace_kmalloc(_RET_IP_, ret, size, PAGE_SIZE << order, flags);
 return ret;
}
EXPORT_SYMBOL(kmalloc_order_trace);
#endif
```
好，这里我想读者们都看得懂，就是返回值要从一个名为`kmalloc_order()`的函数获取，理解这个就好了。

```c
void *kmalloc_order(size_t size, gfp_t flags, unsigned int order)
{
 void *ret = NULL;
 struct page *page;

 if (unlikely(flags & GFP_SLAB_BUG_MASK))
  flags = kmalloc_fix_flags(flags);
```
博主也看不懂`GFP_SLAB_BUG_MASK`是什么，不过会有一个函数帮我们修复标志，所以放心好了。

```c
 flags |= __GFP_COMP;
```
这个是复合页的意思，就是告诉Buddy分配器说“要把页合在一起”，而不是排在一起而已，如果有`__GFP_COMP`的话内核就能找到头页在哪。

```c
 page = alloc_pages(flags, order);
 if (likely(page)) {
  ret = page_address(page);
  mod_lruvec_page_state(page, NR_SLAB_UNRECLAIMABLE_B,
          PAGE_SIZE << order);
 }
```
这里就是从Buddy分配一个页，但是这个页不是我们平常用的那种，而是一个页管理结构体，我们需要把结构体转换为虚拟地址，也就是`page_address()`，这样我们就获得了一个我们平常使用的虚拟地址了。

```c
 ret = kasan_kmalloc_large(ret, size, flags);
 /* As ret might get tagged, call kmemleak hook after KASAN. */
 kmemleak_alloc(ret, size, 1, flags);
 return ret;
}
EXPORT_SYMBOL(kmalloc_order);
```
这些基本都是调试了，博主就不多说了，该看`kfree()`了。

# `kfree()`调用链
同样的先来看看调用链。
```
kfree()
|-- __free_pages() [不是SLAB页]
|	|-- free_the_page()
|	|	|-- free_unref_page() [如果ORDER==1]		/* 小页释放 */
|	|	|-- __free_pages_ok [ELSE] 				/* 大页释放 */
|-- slab_free() [是SLAB页]
|	|-- do_slab_free()
|	|	|-- set_freepointer() [如果释放的地址正好是CPU缓存的]
| 	|	|-- __slab_free() [ELSE]
```
由于深入的话有点复杂，所以这里的调用链真的只有个大概而已。

# `kfree()`源代码
好，接下来直接来看源代码吧，不过博主水平有限，大部分内容不会很详细的解释。

```c
void kfree(const void *x)
{
 struct page *page;
 void *object = (void *)x;

 trace_kfree(_RET_IP_, x); /* 调试的，不管了 */

 if (unlikely(ZERO_OR_NULL_PTR(x)))
  return;
```
释放空指针，这是内核允许的，你别释放别人在用的指针就行了。

```c
 page = virt_to_head_page(x);
```
刚刚在`kmalloc()`我们知道了我们获取的地址是通过一个名为`page_address()`的函数把`struct page *page`转换为更易于使用的虚拟地址。
这里就是把虚拟地址转换回那个`page`。

```c
 if (unlikely(!PageSlab(page))) {
  unsigned int order = compound_order(page);

  BUG_ON(!PageCompound(page));
  kfree_hook(object);
  mod_lruvec_page_state(page, NR_SLAB_UNRECLAIMABLE_B,
          -(PAGE_SIZE << order));
  __free_pages(page, order);
  return;
 }
```
这里的条件判断是，如果`page`不属于SLAB，也就是并非SLAB分配器所分配的页，那就以页为单位进行释放。

```c
 slab_free(page->slab_cache, page, object, NULL, 1, _RET_IP_);
}
EXPORT_SYMBOL(kfree);
```
这里就是比较常用的，小对象的释放。

## SLAB
同样的，由于我们一般是用`kfree()`释放小对象，所以就先说SLAB的版本。

```c
static __always_inline void slab_free(struct kmem_cache *s, struct page *page,
				      void *head, void *tail, int cnt,
				      unsigned long addr)
{
	if (slab_free_freelist_hook(s, &head, &tail, &cnt))
		do_slab_free(s, page, head, tail, cnt, addr);
}
```
`slab_free_freelist_hook()`是调试用的，这里可以先跳过，直接进去下一个函数。

```c
static __always_inline void do_slab_free(struct kmem_cache *s,
				struct page *page, void *head, void *tail,
				int cnt, unsigned long addr)
{
	void *tail_obj = tail ? : head;
	struct kmem_cache_cpu *c;
	unsigned long tid;

	if (!tail) /* 这条件的结果在这必然为真 */
		memcg_slab_free_hook(s, &head, 1);
```
`memcg_slab_free_hook()`：这是内存控制组（memcg）的相关函数，只有在启用`CONFIG_MEMCG_KMEM`时才会实际执行。

它的主要工作是：
1. 通过`virt_to_head_page()`找到对象所属的页头
2. 从页面的`obj_cgroups`数组中找到对应的内存控制组记录
3. 执行三项关键操作：
   - `obj_cgroup_uncharge()`：减少控制组的内存总占用量
   - `mod_objcg_state()`：更新内存统计状态
   - `obj_cgroup_put()`：减少控制组的引用计数

一般上有"put"的函数就是减少引用次数的意思。

简单理解就是：当对象释放时，需要更新内存资源记账系统，确保每个cgroup使用的内存量统计准确。
如果还是看不懂的话，那也没关系，就只是个记账的函数而已，对我们理解`kfree()`的帮助不是太大。

```c
redo:
	do {
		tid = this_cpu_read(s->cpu_slab->tid);
		c = raw_cpu_ptr(s->cpu_slab);
	} while (IS_ENABLED(CONFIG_PREEMPTION) &&
		 unlikely(tid != READ_ONCE(c->tid)));

	barrier(); /* 之前解释过，不让前后乱序 */
```
这里是和之前一样的乐观锁，我们在`kmalloc()`那里解释过了。

```c
	if (likely(page == c->page)) { /* struct kmem_cache_cpu *c; */
		void **freelist = READ_ONCE(c->freelist);

		set_freepointer(s, tail_obj, freelist);

		if (unlikely(!this_cpu_cmpxchg_double(
				s->cpu_slab->freelist, s->cpu_slab->tid,
				freelist, tid,
				head, next_tid(tid)))) {

			note_cmpxchg_failure("slab_free", s, tid);
			goto redo;
		}
		stat(s, FREE_FASTPATH);
```
这个还算是好理解的，进入的条件是，如果我们要释放的对象位于该CPU的缓存中。
接下来，博主来解释一下一些函数：
`set_freepointer(s, tail_obj, freelist)`：让`tail_obj`（要释放的对象）的FREE POINTER指向`freelist`（也就是第一个空对象）。
`this_cpu_cmpxchg_double()`： 这个刚刚解释过咯，可以翻到`kmalloc()`节看看。

```c
	} else
		__slab_free(s, page, head, tail_obj, cnt, addr);

}
```
这个就是个比较通用的路径，也叫做慢路径，刚刚的就叫做快路径。

### 快路径
我们先看比较理想化的吧，因为这种一般没有太多判断，而且比较容易触发。

```c
static inline void set_freepointer(struct kmem_cache *s, void *object, void *fp)
{
	unsigned long freeptr_addr = (unsigned long)object + s->offset;
```
这个刚刚我们也见到了，就是每个对象的FREE POINTER位置都是相对固定的，只要加上对应的偏移量就能找到了，只是我们在分配的时候释放掉了FREE POINTER。

```c
	*(void **)freeptr_addr = freelist_ptr(s, fp, freeptr_addr); /* void **freelist */
}
```
这里最重要的就是`freelist_ptr()`了，可以先把他理解为获得一个**加密版本**的`freelist`。
就是让`object`的FREE POINTER存储加密后的`freelist`地址！

简单点说就是，让`object`的FREE POINTER指向`freelist`。（超级好理解吧哼哼）

```c
static inline void *freelist_ptr(const struct kmem_cache *s, void *ptr,
				 unsigned long ptr_addr)
{
#ifdef CONFIG_SLAB_FREELIST_HARDENED
	return (void *)((unsigned long)ptr ^ s->random ^
			swab((unsigned long)kasan_reset_tag((void *)ptr_addr)));
#else
	return ptr;
#endif
}
```
这个`freelist_ptr()`是在实现FREE POINTER的混淆技术。
当开启`CONFIG_SLAB_FREELIST_HARDENED`配置时，它会对FREE POINTER进行异或加密：
- `s->random`是每个`kmem_cache`独有的随机数。
- `ptr_addr`是存储这个指针的内存地址。
- 通过**异或**操作把原始指针`ptr`加密存储。

说实话我也没怎么看懂，所以...我们就当作它只会返回`ptr`吧？
当然，是加密后的版本，毕竟直接返回`ptr`也行的话就代表这两个是通用的，不过在不同配置下不通用。

#### 从`set_freepointer()`返回后 / 快路径的结束

```c
		if (unlikely(!this_cpu_cmpxchg_double(
				s->cpu_slab->freelist, s->cpu_slab->tid,
				freelist, tid,
				head, next_tid(tid)))) {
```
返回后，就会执行这里，我们就默认它不会执行失败吧！
如果执行成功了，最主要的作用就是`freelist`会把地址改为我们的这位小对象，而我们的小对象FREE POINTER在刚刚就已经指向上一个`freelist`了，所以不用担心哪个小对象会不见！

其他的就不必管了，不是什么大问题。
啊还有，要问如果失败会怎么样的话...首选会先记录，然后重来（`redo`），不过`redo`我们就不看了...

### 慢路径
好，现在我们来看一个更通用，但是更复杂的路径，名为慢路径。
```c
static void __slab_free(struct kmem_cache *s, struct page *page,
			void *head, void *tail, int cnt,
			unsigned long addr)

{
	void *prior;
	int was_frozen;
	struct page new;
	unsigned long counters;
	struct kmem_cache_node *n = NULL;
	unsigned long flags;

	stat(s, FREE_SLOWPATH);

	if (kmem_cache_debug(s) &&
	    !free_debug_processing(s, page, head, tail, cnt, addr))
		return;
```
第一个函数主要是检查类的函数，对我们理解`kfree()`核心逻辑的帮助不大，不过可以稍微过一下。

这个函数主要是做：
- 检查双重释放（double free）
- 验证对象边界和完整性
- 内存泄漏检测
- 各种slub调试功能

```c
	do {
		if (unlikely(n)) {
			spin_unlock_irqrestore(&n->list_lock, flags);
			n = NULL;
		}
```
这个的意思是，如果while条件不成功，就要放弃之前拿的`kmem_cache_node`。

```c
		/* 重点，其他的可以稍微不那么在意 */
		prior = page->freelist;
		counters = page->counters;
		set_freepointer(s, tail, prior); /* 让tail的fp指向prior */
		new.counters = counters;
		was_frozen = new.frozen;
		new.inuse -= cnt;
```
这里重点说一下`counters = page->counters`，可能会有读者好奇，`was_frozen = new.frozen`这行难道不是未定义行为吗？
说起来挺神奇的，似乎是`page->counters`这个字段就包含了`frozen`字段，好像是因为页管理使用了神奇的位标志来管理字段。

接下来再解释一下各个字段的意思：
- `counters`：一个很神奇的字段，叫作复合字段，通过位存储多个状态信息
- `frozen`：这个表示当前页有没有在CPU上面缓存（1 = 在缓存，0 = 不在缓存）
- `inuse`：当前SLAB页面中已分配的对象数量（使用中的）

```c
		if ((!new.inuse || !prior) && !was_frozen) {

			if (kmem_cache_has_cpu_partial(s) && !prior) {
			
				new.frozen = 1;
				
			} else {
			
				n = get_node(s, page_to_nid(page));
				spin_lock_irqsave(&n->list_lock, flags);

			}
		}

	} while (!cmpxchg_double_slab(s, page,
		prior, counters,
		head, new.counters,
		"__slab_free"));
```
- `new.inuse`：释放我们的对象后，还有没有其他使用中的对象在当前SLAB页。
- `prior`：当前SLAB页是否还有空闲的对象。
- `was_frozen`：这个页是不是本来就已经在缓存上了。

然后我们说一下if-else分支分别是干什么的：
- if：如果这个`kmem_cache`是适合保存在CPU上的 && 还有空闲的对象。
那就把这SLAB页面缓存在CPU上。
- else：获取当前`kmem_cache`在NODE上的缓存，并用自旋锁保护一下。

`cmpxchg_double_slab()`：这个也不难，读者们可以尝试自己看看源代码。
只要同时达成这个条件：
```c
page->freelist == prior
page->counters == counters
```
那就会执行：
```c
page->freelist = head;
page->counters = new.counters
```
之后`page`的`frozen`和`inuse`之类的就变成`new`计算好的那些了。

`s`的话，就是个记录用的，不用管！

#### 为什么if分支不加锁？
我们先暂且把if分支称为“FROZEN分支”吧。

FROZEN分支从循环出去后，必然操作该CPU独占的数据，不可能是其他CPU的数据或共享的数据，所以不需要锁，所有CPU都只能访问自己的CPU数据。
而ELSE分支从循环出去后，必然操作共享的数据，所以就得带上锁，避免和其他CPU同时的修改某个数据。

简单的说就是：
- FROZEN分支操作的是“CPU私有资源”，天然无并发。
- E;SE分支操作的是“全局共享资源”，必须加锁同步。

```c
	if (likely(!n)) {

		if (likely(was_frozen)) {
			stat(s, FREE_FROZEN);
		} else if (new.frozen) {
			put_cpu_partial(s, page, 1);
			stat(s, CPU_PARTIAL_FREE);
		}

		return;
	}
```
从这里的触发条件可以看出，刚刚的FROZEN分支触发概率更高。
这里的逻辑是：
- IF分支：
如果本来就已经被缓存了，那就直接记录这次的行为并返回就行了。读者可能好奇为什么没有释放的操作，其实已经有了，就在刚刚的：
```c
		set_freepointer(s, tail, prior); /* 让tail的fp指向prior */
		page->freelist = head; /* 这里就已经完成释放了 */
		page->counters = new.counters;
```
可以说和快路径很像呢。

- ELSE分支：
如果是刚刚要缓存的，那就直接把当前SLAB页面放进CPU缓存内，至于上一个SLAB页面怎么处理...内核肯定有自己的办法吧。
至此，FROZEN分支的操作完毕，就如之前所说的，FROZEN分支只可能操作当前CPU。

```c
	if (unlikely(!new.inuse && n->nr_partial >= s->min_partial))
		goto slab_empty;

	if (!kmem_cache_has_cpu_partial(s) && unlikely(!prior)) {
		remove_full(s, n, page);
		add_partial(n, page, DEACTIVATE_TO_TAIL);
		stat(s, FREE_ADD_PARTIAL);
	}
	spin_unlock_irqrestore(&n->list_lock, flags);
	return;
```
能来到这里的只有可能是ELSE分支过来的了。
第一个条件判断：
页面完全空闲 + 当前节点已经有足够多的PARTIAL SLAB页面了。
既然已经用不到了，那就会全部还给BUDDY了。

第二个条件判断：
如果这个`kmem_cache`不支持在CPU上缓存，并且已经满了。
那就要把它从FULL换成PARTIAL。
其实`remove_full`和`add_partial`的意思更接近REMOVE SLAB FROM FULL和ADD SLAB TO PARTIAL。

```c
slab_empty:
	if (prior) {
		remove_partial(n, page);
		stat(s, FREE_REMOVE_PARTIAL);
	} else {
		remove_full(s, n, page);
	}

	spin_unlock_irqrestore(&n->list_lock, flags);
	stat(s, FREE_SLAB);
	discard_slab(s, page);
}
```
全部还回去的实现有两个，就普通来说的话，只有可能是IF分支。
IF分支是说现在还有空闲对象，所以就视为PARTIAL，把该SLAB从PARTIAL列表中移除。
ELSE分支是说，本来就是满的，现在调用方要全部释放，但是`kfree()`只释放单个对象，所以不可能是ELSE分支。
最后的`discard_slab()`就是，真正的释放，之前的只是从列表中移除而已。

好的，慢路径正式结束！`kfree()`没有返回所以我们就不说了！

## 页释放
虽然这类释放比较不常用，不过概率还没到几乎用不到，所以还是得说一下。
```c
void __free_pages(struct page *page, unsigned int order)
{
 int head = PageHead(page);
```
博主不理解为何这里要在定位到头多一次，而且博主也找不到这个函数。
博主想这个应该只是判断page是否为头页。

```c
if (put_page_testzero(page))
  free_the_page(page, order);
```
测试是否是最后一个引用，如果是就释放，如果不是就直接结束。

```c
 else if (!head)
  while (order-- > 0)
   free_the_page(page + (1 << order), order);
}
EXPORT_SYMBOL(__free_pages);
```
这个就博主看不懂，不过由于`kfree()`路径不可能触发这里，所以就不管了！

```c
static inline void free_the_page(struct page *page, unsigned int order)
{
	if (order == 0)
		free_unref_page(page);
	else
		__free_pages_ok(page, order, FPI_NONE);
}
```
我们进去这里，可以发现，页释放有两种情况，一种是单页，一种是复合页。会分两种情况是因为小页适合缓存，而大页不适合，下次申请很难和缓存上的`order`相同。

#### 单页释放
```c
void free_unref_page(struct page *page)
{
	unsigned long flags;
	unsigned long pfn = page_to_pfn(page);

	if (!free_unref_page_prepare(page, pfn))
		return;

	local_irq_save(flags);
	free_unref_page_commit(page, pfn);
	local_irq_restore(flags);
}
```
首先先获得`pfn`，这个是找到页物理地址的关键，之后再准备一些东西，准备什么先不用太在意，我们直接去看主逻辑。

```c
static void free_unref_page_commit(struct page *page, unsigned long pfn)
{
	struct zone *zone = page_zone(page);
	struct per_cpu_pages *pcp;
	int migratetype;

	migratetype = get_pcppage_migratetype(page);
	__count_vm_event(PGFREE);
```
这里基本都是准备+调试而已。

```c
	if (migratetype >= MIGRATE_PCPTYPES) {
		if (unlikely(is_migrate_isolate(migratetype))) {
			free_one_page(zone, page, pfn, 0, migratetype,
				      FPI_NONE);
			return;
		}
		migratetype = MIGRATE_MOVABLE;
	}
```
这个循环的意思是，如果迁移类型不是以下这些：
```c
MIGRATE_UNMOVABLE,
MIGRATE_MOVABLE,
MIGRATE_RECLAIMABLE,
```
那就检测是否为`MIGRATE_ISOLATE`，如果是，那就直接释放，隔离页不能存放在PCP上。
如果不是隔离页，那么就暂时标记为`MIGRATE_MOVABLE`，并不会改变页本身的迁移类型。

```c
	pcp = &this_cpu_ptr(zone->pageset)->pcp;
	list_add(&page->lru, &pcp->lists[migratetype]);
	pcp->count++;
	if (pcp->count >= pcp->high) {
		unsigned long batch = READ_ONCE(pcp->batch);
		free_pcppages_bulk(zone, batch, pcp);
	}
}
```
然后把页添加进对应的迁移类型的PCP链表上，并增加PCP总页数。
之后会再检查PCP总页数是否太多了，如果太多了，就会释放一部分，因为要保证不会爆满。

```c
static void free_pcppages_bulk(struct zone *zone, int count,
					struct per_cpu_pages *pcp)
{
	int migratetype = 0;
	int batch_free = 0;
	int prefetch_nr = 0;
	bool isolated_pageblocks;
	struct page *page, *tmp;
	LIST_HEAD(head);
```
这里先不用太在意，记一下就行了，反正之后还可以回来再看。
`head`是我们的临时链表。

```c
	count = min(pcp->count, count);
	while (count) {
		struct list_head *list;

		do {
			batch_free++;
			if (++migratetype == MIGRATE_PCPTYPES)
				migratetype = 0;
			list = &pcp->lists[migratetype];
		} while (list_empty(list));
```
第一个循环，这个DO-WHILE循环是要找到有哪个类型的PCP链表是有东西的，而非空的。
`batch_free`：循环次数记录
这个循环只会检查：
```c
MIGRATE_UNMOVABLE,
MIGRATE_MOVABLE,
MIGRATE_RECLAIMABLE,
```
其他的类型不会被检查。

```c
		if (batch_free == MIGRATE_PCPTYPES)
			batch_free = count;
```
触发这里时，代表`if (++migratetype == MIGRATE_PCPTYPES)`也同样被触发了，否则不可能触发这里。
具体目的是什么博主也不清楚，只能先看再说。

```c
		do {
			page = list_last_entry(list, struct page, lru);
			list_del(&page->lru);
			pcp->count--;

			if (bulkfree_pcp_prepare(page))
				continue;

			list_add_tail(&page->lru, &head);

			if (prefetch_nr++ < pcp->batch)
				prefetch_buddy(page);
		} while (--count && --batch_free && !list_empty(list));
	}
```
这个循环做的事情就是：
- 从非空`list`获取页
- 从PCP链表中移除该页
- 减少总页数
- 把页加入临时链表

`prepare`的话基本都是准备，在遇到问题前我一般都不会看这类函数，因为核心逻辑一般不在那里。
`prefetch_buddy()`：把`page`对应的`buddy`放到缓存预热下，减少缓存未命中的可能性。

简单点来说，这基本就是真正释放前做的准备而已。

```c
	spin_lock(&zone->lock);
	isolated_pageblocks = has_isolate_pageblock(zone);

	list_for_each_entry_safe(page, tmp, &head, lru) {
		int mt = get_pcppage_migratetype(page);
		VM_BUG_ON_PAGE(is_migrate_isolate(mt), page);
		if (unlikely(isolated_pageblocks))
			mt = get_pageblock_migratetype(page);

		__free_one_page(page, page_to_pfn(page), zone, 0, mt, FPI_NONE);
		trace_mm_page_pcpu_drain(page, 0, mt);
	}
	spin_unlock(&zone->lock);
}
```
这个循环会遍历`head`，
`__free_one_page()`：这个我打算在复合页释放细说，这里的话就只要知道，这个函数是把页释放回BUDDY的就好了。

# 总结
还没完成，不过博主想睡觉了...（倒下）

## 之后的打算
博主之后打算重新整理一下这篇博文，因为感觉这样的结构有点乱，也不利于管理。
博主可能会把部分函数移到其他博文，其他博文可能会叫“实用的内存管理内部API”之类的。
反正就是，感觉这里的基础科普有点太多了，当然一部分原因是因为博主自己也是刚学的，所以就写下来了。
之后会把比较基础的放到别的博文里，比较易于管理。

最后编辑时间：2025/10/29 AM04:05
